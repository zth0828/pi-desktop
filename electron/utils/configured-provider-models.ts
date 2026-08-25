import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONTEXT_WINDOW } from '@shared/host-api/contract';
import { matchModelProfile, matchModelProfileEntry } from '@shared/model-profiles';

type JsonRecord = Record<string, unknown>;

export type ProviderDirectoryAuth = {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};

export type ProviderModelSyncResult = {
  providerId: string;
  discovered: number;
  added: number;
  changed: boolean;
};

export type ThinkingLevelMap = Record<string, string | null>;

type DetectedModel = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: ThinkingLevelMap;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseThinkingLevelMap(value: unknown): ThinkingLevelMap | undefined {
  const obj = record(value);
  if (!obj) return undefined;
  const result: ThinkingLevelMap = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || typeof val === 'string') {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function positiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
  }
  headers[name] = value;
}

function directoryUrlCandidates(baseUrl: string, api: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  if (api === 'anthropic-messages') {
    // Anthropic SDK 自动补 /v1/messages；目录同样要落在 /v1/models。
    return [/\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`];
  }
  if (api === 'google-generative-ai') return [`${base}/models`];
  // openai-completions / openai-responses：客户端把 baseUrl 原样拼接上 /chat/completions
  //（或 /responses），vLLM 这类服务器只暴露 /v1 前缀下的路由。无 /v1 时先试根路径
  // 再试 /v1，与 GUI probe 的候选路径一致，避免目录探测漏掉 /v1/models。
  const roots = /\/v1$/i.test(base) ? [base] : [base, `${base}/v1`];
  return roots.map((root) => `${root}/models`);
}

function directoryHeaders(api: string, auth: ProviderDirectoryAuth): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth.apiKey) {
    if (api === 'anthropic-messages') {
      setHeader(headers, 'x-api-key', auth.apiKey);
      setHeader(headers, 'anthropic-version', '2023-06-01');
    } else if (api === 'google-generative-ai') {
      setHeader(headers, 'x-goog-api-key', auth.apiKey);
    } else {
      setHeader(headers, 'authorization', `Bearer ${auth.apiKey}`);
    }
  }
  for (const [name, value] of Object.entries(auth.headers ?? {})) setHeader(headers, name, value);
  return headers;
}

export function parseProviderModelDirectory(payload: unknown, api: string): DetectedModel[] {
  const root = record(payload);
  const rows = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(root?.models) ? root.models : [];
  const detected: DetectedModel[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = typeof raw === 'string' ? { id: raw } : record(raw);
    if (!row) continue;
    let id = String(row.id ?? row.name ?? row.model ?? '').trim();
    if (api === 'google-generative-ai') id = id.replace(/^models\//, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const capabilities = record(row.capabilities);
    const rawInput = Array.isArray(row.input) ? row.input : undefined;
    const input = rawInput
      ?.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image');
    const vision = capabilities?.vision === true || capabilities?.image === true;
    const displayName = String(row.display_name ?? row.displayName ?? '').trim();
    const reasoning = typeof row.reasoning === 'boolean'
      ? row.reasoning
      : capabilities?.reasoning === true || record(capabilities?.reasoning) !== null
        ? true
        : undefined;
    const rawThinkingLevelMap = row.thinkingLevelMap ?? row.thinking_level_map
      ?? capabilities?.thinkingLevelMap ?? capabilities?.thinking_level_map;
    const thinkingLevelMap = parseThinkingLevelMap(rawThinkingLevelMap);
    detected.push({
      id,
      ...(displayName ? { name: displayName } : {}),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      ...(input?.length ? { input } : vision ? { input: ['text', 'image'] } : {}),
      ...(positiveNumber(row.contextWindow, row.context_window, row.context_length, row.max_context_length, row.max_model_len)
        ? { contextWindow: positiveNumber(row.contextWindow, row.context_window, row.context_length, row.max_context_length, row.max_model_len) }
        : {}),
      ...(positiveNumber(row.maxTokens, row.max_tokens, row.max_output_tokens)
        ? { maxTokens: positiveNumber(row.maxTokens, row.max_tokens, row.max_output_tokens) }
        : {}),
    });
  }
  return detected;
}

/** 历史兜底 contextWindow：这些值说明记录来自旧版缺省写入而非真实目录/规格数据。 */
const LEGACY_FALLBACK_CONTEXT_WINDOWS = new Set([DEFAULT_CONTEXT_WINDOW, 128000]);

/** current.input 是否为历史默认（缺失或 ['text']）：可被目录/规格表升级。 */
function isLegacyDefaultInput(current: JsonRecord): boolean {
  const input = current.input;
  if (!Array.isArray(input)) return true;
  return input.length === 1 && input[0] === 'text';
}

/**
 * 已存在模型的陈旧字段刷新：只纠正历史缺省写入的值，用户改过的字段不动。
 * - input：未 pin（inputPinned !== true）且当前为历史默认 → 目录上报/规格表升级。
 * - contextWindow：缺失或等于兜底值 → 目录 > template > 规格表。
 * - maxTokens：缺失 → 目录 > template > 规格表。
 * reasoning/cost/name 与用户改过的非兜底 contextWindow 保持原样。
 */
function refreshStaleModel(
  current: JsonRecord,
  model: DetectedModel | null,
  template: JsonRecord,
): JsonRecord {
  const next: JsonRecord = { ...current };
  const { matched, profile } = matchModelProfileEntry(String(current.id ?? ''));
  const detectedInput = model?.input ?? (matched ? profile.input : undefined);
  if (current.inputPinned !== true && isLegacyDefaultInput(current) && detectedInput) {
    next.input = detectedInput;
  }
  const currentContext = positiveNumber(current.contextWindow);
  // template（用户/目录写过的真实值）优先；未命中规格表时兜底 profile 只是
  // 保守默认，不作为"更准确值"写入。
  const betterContext = model?.contextWindow
    ?? positiveNumber(template.contextWindow)
    ?? (matched ? profile.contextWindow : undefined);
  if ((!currentContext || LEGACY_FALLBACK_CONTEXT_WINDOWS.has(currentContext)) && betterContext) {
    next.contextWindow = betterContext;
  }
  if (!positiveNumber(current.maxTokens)) {
    const maxTokens = model?.maxTokens
      ?? positiveNumber(template.maxTokens)
      ?? (matched ? profile.maxTokens : undefined);
    if (maxTokens) next.maxTokens = maxTokens;
  }
  return next;
}

export function mergeDiscoveredProviderModels(existing: unknown[], detected: DetectedModel[]): JsonRecord[] {
  const existingModels = existing.map(record).filter((model): model is JsonRecord => model !== null);
  const byId = new Map(existingModels.map((model) => [String(model.id ?? ''), model]));
  const template = existingModels[0] ?? {};
  const merged = detected.map((model) => {
    const current = byId.get(model.id);
    if (current) {
      return refreshStaleModel(current, model, template);
    }
    return {
      id: model.id,
      name: model.name ?? model.id,
      // 第三方目录普遍不上报推理能力：缺省按支持处理，让思考深度可用；
      // 供应商拒绝思考参数时用户可在 Models 页逐模型关闭（写入后不被发现流程覆盖）。
      reasoning: model.reasoning ?? (typeof template.reasoning === 'boolean' ? template.reasoning : true),
      ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      // input 优先级：目录上报 > 规格表（已知视觉模型）> 供应商模板继承 > 纯文本。
      // 目录显式 text 优先于规格表：网关可能确实剥离了视觉。
      input: model.input
        ?? matchModelProfile(model.id).input
        ?? (Array.isArray(template.input) ? template.input : ['text']),
      cost: record(template.cost) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow
        ?? positiveNumber(template.contextWindow)
        ?? DEFAULT_CONTEXT_WINDOW,
      ...(model.maxTokens
        ? { maxTokens: model.maxTokens }
        : positiveNumber(template.maxTokens) ? { maxTokens: positiveNumber(template.maxTokens) } : {}),
    };
  });
  const detectedIds = new Set(detected.map((model) => model.id));
  // 目录未列出的旧模型（手动 modelIds 添加）也走规格表刷新：多模态/规格识别
  // 不应因目录不收录而失效。
  merged.push(...existingModels
    .filter((model) => !detectedIds.has(String(model.id ?? '')))
    .map((model) => refreshStaleModel(model, null, template)));
  return merged;
}

export async function syncConfiguredProviderModels(options: {
  agentDir: string;
  providerId: string;
  api: string;
  auth: ProviderDirectoryAuth;
  fetchImpl?: typeof fetch;
}): Promise<ProviderModelSyncResult | null> {
  const modelsPath = path.join(options.agentDir, 'models.json');
  if (!existsSync(modelsPath)) return null;
  const doc = JSON.parse(readFileSync(modelsPath, 'utf8')) as JsonRecord;
  const providers = record(doc.providers);
  const provider = record(providers?.[options.providerId]);
  if (!provider || typeof provider.baseUrl !== 'string') return null;
  const baseUrl = options.auth.baseUrl ?? provider.baseUrl;
  let lastError: Error | undefined;
  let response: Response | null = null;
  for (const url of directoryUrlCandidates(baseUrl, options.api)) {
    try {
      const candidate = await (options.fetchImpl ?? fetch)(url, {
        headers: directoryHeaders(options.api, options.auth),
        signal: AbortSignal.timeout(12_000),
      });
      if (candidate.ok) {
        response = candidate;
        break;
      }
      lastError = new Error(`model directory returned HTTP ${candidate.status} (${url})`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!response) throw lastError ?? new Error('model directory unreachable');
  const detected = parseProviderModelDirectory(await response.json(), options.api);
  if (detected.length === 0) {
    return { providerId: options.providerId, discovered: 0, added: 0, changed: false };
  }
  const existing = Array.isArray(provider.models) ? provider.models : [];
  const existingIds = new Set(existing.map((model) => String(record(model)?.id ?? '')));
  const models = mergeDiscoveredProviderModels(existing, detected);
  const changed = JSON.stringify(models) !== JSON.stringify(existing);
  if (changed) {
    provider.models = models;
    writeFileSync(modelsPath, JSON.stringify(doc, null, 2));
  }
  return {
    providerId: options.providerId,
    discovered: detected.length,
    added: detected.filter((model) => !existingIds.has(model.id)).length,
    changed,
  };
}
