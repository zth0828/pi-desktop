import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

type DetectedModel = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
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

function directoryUrl(baseUrl: string, api: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (api === 'anthropic-messages' && !/\/v1$/i.test(base)) return `${base}/v1/models`;
  return `${base}/models`;
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
    detected.push({
      id,
      ...(displayName ? { name: displayName } : {}),
      ...(reasoning === undefined ? {} : { reasoning }),
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

export function mergeDiscoveredProviderModels(existing: unknown[], detected: DetectedModel[]): JsonRecord[] {
  const existingModels = existing.map(record).filter((model): model is JsonRecord => model !== null);
  const byId = new Map(existingModels.map((model) => [String(model.id ?? ''), model]));
  const template = existingModels[0] ?? {};
  const merged = detected.map((model) => {
    const current = byId.get(model.id);
    if (current) return current;
    return {
      id: model.id,
      name: model.name ?? model.id,
      reasoning: model.reasoning ?? (typeof template.reasoning === 'boolean' ? template.reasoning : false),
      input: model.input ?? (Array.isArray(template.input) ? template.input : ['text']),
      cost: record(template.cost) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(model.contextWindow
        ? { contextWindow: model.contextWindow }
        : positiveNumber(template.contextWindow) ? { contextWindow: positiveNumber(template.contextWindow) } : {}),
      ...(model.maxTokens
        ? { maxTokens: model.maxTokens }
        : positiveNumber(template.maxTokens) ? { maxTokens: positiveNumber(template.maxTokens) } : {}),
    };
  });
  const detectedIds = new Set(detected.map((model) => model.id));
  merged.push(...existingModels.filter((model) => !detectedIds.has(String(model.id ?? ''))));
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
  const response = await (options.fetchImpl ?? fetch)(directoryUrl(baseUrl, options.api), {
    headers: directoryHeaders(options.api, options.auth),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`model directory returned HTTP ${response.status}`);
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
