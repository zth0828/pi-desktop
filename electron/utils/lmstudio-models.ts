import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

export type LmStudioModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow?: number;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseLmStudioModels(payload: unknown): LmStudioModel[] {
  const root = record(payload);
  const rows = Array.isArray(root?.models)
    ? root.models
    : Array.isArray(root?.data) ? root.data : [];
  const models: LmStudioModel[] = [];
  for (const raw of rows) {
    const row = record(raw);
    if (!row || (typeof row.type === 'string' && row.type !== 'llm')) continue;
    const id = String(row.key ?? row.id ?? row.model ?? '').trim();
    if (!id) continue;
    const capabilities = record(row.capabilities);
    const instances = Array.isArray(row.loaded_instances) ? row.loaded_instances : [];
    const loadedContexts = instances
      .map((instance) => positiveNumber(record(record(instance)?.config)?.context_length))
      .filter((value): value is number => value !== undefined);
    const contextWindow = loadedContexts[0] ?? positiveNumber(row.max_context_length);
    models.push({
      id,
      name: String(row.display_name ?? row.name ?? id),
      reasoning: capabilities?.reasoning === true || record(capabilities?.reasoning) !== null,
      input: capabilities?.vision === true ? ['text', 'image'] : ['text'],
      ...(contextWindow ? { contextWindow } : {}),
    });
  }
  return models;
}

export function mergeLmStudioModels(existing: unknown[], detected: LmStudioModel[]): unknown[] {
  const byId = new Map<string, JsonRecord>();
  for (const raw of existing) {
    const model = record(raw);
    if (model && typeof model.id === 'string') byId.set(model.id, model);
  }
  return detected.map((model) => {
    const current = byId.get(model.id) ?? {};
    return {
      ...current,
      id: model.id,
      name: typeof current.name === 'string' ? current.name : model.name,
      reasoning: model.reasoning,
      // LM Studio 思考控制只认 reasoning_effort：off 档必须映射到 "none" 才能
      // 真正关闭思考（enable_thinking 会被 llama.cpp 忽略）。旧记录没有时补上。
      ...(model.reasoning && !record(current.thinkingLevelMap)?.off
        ? { thinkingLevelMap: { off: 'none' } }
        : {}),
      input: model.input,
      cost: record(current.cost) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      maxTokens: positiveNumber(current.maxTokens) ?? 8192,
    };
  });
}

export function isLmStudioProvider(id: string, provider: JsonRecord): boolean {
  if (/lm[ -]?studio/i.test(id)) return true;
  if (typeof provider.name === 'string' && /lm[ -]?studio/i.test(provider.name)) return true;
  if (typeof provider.baseUrl !== 'string') return false;
  try {
    const url = new URL(provider.baseUrl);
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.port === '1234';
  } catch {
    return false;
  }
}

/** 本机回环地址上的 OpenAI 兼容服务器：LM Studio/Ollama/vLLM 等本地实例。 */
export function isLocalServer(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host);
  } catch {
    return false;
  }
}

export async function syncLmStudioModels(agentDir: string): Promise<boolean> {
  const modelsPath = path.join(agentDir, 'models.json');
  if (!existsSync(modelsPath)) return false;
  let doc: JsonRecord;
  try {
    doc = JSON.parse(readFileSync(modelsPath, 'utf8')) as JsonRecord;
  } catch {
    return false;
  }
  const providers = record(doc.providers);
  if (!providers) return false;
  let changed = false;
  for (const [id, raw] of Object.entries(providers)) {
    const provider = record(raw);
    if (!provider || !isLmStudioProvider(id, provider) || typeof provider.baseUrl !== 'string') continue;
    // 占位 apiKey：pi 请求时强制要求鉴权（models.md：keyless 本地服务器应保留
    // 占位值），LM Studio 会忽略 Authorization 头。旧配置没写时补上。
    if (typeof provider.apiKey !== 'string') {
      provider.apiKey = 'lm-studio';
      changed = true;
    }
    // 思考控制：旧配置只有 developer/reasoning_effort 兼容声明，没有按模型映射
    // off 档。LM Studio 只认 reasoning_effort（enable_thinking 被 llama.cpp 忽略），
    // 缺映射时 pi 的 off 档不发任何参数，推理模型仍按默认档位思考。补
    // supportsReasoningEffort=true + 模型级 thinkingLevelMap.off="none"，off 档发
    // reasoning_effort:none 真正关闭思考；其余档位分级直传。
    const compat = record(provider.compat) ?? {};
    const needsCompat = compat.supportsReasoningEffort !== true || 'thinkingFormat' in compat;
    if (needsCompat) {
      compat.supportsDeveloperRole = false;
      compat.supportsReasoningEffort = true;
      delete compat.thinkingFormat;
      provider.compat = compat;
      changed = true;
    }
    if (Array.isArray(provider.models)) {
      for (const rawModel of provider.models) {
        const model = record(rawModel);
        if (!model || model.reasoning !== true) continue;
        const tlm = record(model.thinkingLevelMap) ?? {};
        if (typeof tlm.off !== 'string') {
          tlm.off = 'none';
          model.thinkingLevelMap = tlm;
          changed = true;
        }
      }
    }
    try {
      const base = provider.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const response = await fetch(`${base}/api/v1/models`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) continue;
      const detected = parseLmStudioModels(await response.json());
      if (detected.length === 0) continue;
      const nextModels = mergeLmStudioModels(Array.isArray(provider.models) ? provider.models : [], detected);
      if (JSON.stringify(nextModels) !== JSON.stringify(provider.models)) {
        provider.models = nextModels;
        changed = true;
      }
    } catch {
      // LM Studio may be stopped; keep the last known pi configuration intact.
    }
  }
  if (changed) writeFileSync(modelsPath, JSON.stringify(doc, null, 2));
  return changed;
}
