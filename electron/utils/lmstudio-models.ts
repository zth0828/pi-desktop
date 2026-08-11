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
