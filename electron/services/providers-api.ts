// providers 模块：pi ModelRuntime 的封装（供应商枚举、认证状态、key 录入、OAuth、
// 自定义供应商）。key 存取全程经 pi 的 auth-storage（login/logout），壳不写 auth.json。
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONTEXT_WINDOW } from '@shared/host-api/contract';
import { matchModelProfile } from '@shared/model-profiles';
import type {
  HostSuccess,
  PiDefaultModel,
  PiDefaultModelResult,
  PiProviderAddCustomPayload,
  PiProviderListResult,
  PiProviderRow,
  PiProviderSetKeyPayload,
  PiProviderProbePayload,
  PiProviderProbeResult,
  PiProviderSetModelReasoningPayload,
  PiProviderSetKeyResult,
  PiCompactionSettings,
  PiRetrySettingsPayload,
  PiRetrySettingsResult,
  PiDefaultThinkingResult,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiAdapter, type PiModelRuntimeHandle } from './pi-adapter';
import { isLmStudioProvider, syncLmStudioModels } from '../utils/lmstudio-models';
import { syncConfiguredProviderModels } from '../utils/configured-provider-models';
import {
  piRuntimeApi,
  reloadRuntimeSettings,
  resolveRuntimeForContext,
  resolveRuntimeForContextReady,
} from './pi-runtime-api';
import type { HostActionContext } from '../main/ipc/host-contract';
import { settingsApi } from './settings-api';

type ModelRuntime = PiModelRuntimeHandle;

let runtimePromise: Promise<ModelRuntime> | null = null;
let runtimeGeneration = '';

async function getModelRuntime(ctx?: HostActionContext): Promise<{
  adapter: Awaited<ReturnType<typeof loadPiAdapter>>;
  runtime: ModelRuntime;
  agentDir: string;
}> {
  const active = await resolveRuntimeForContextReady(ctx);
  if (active) {
    return { adapter: active.adapter, runtime: active.modelRuntimeHandle, agentDir: active.adapter.paths.getAgentDir() };
  }
  const adapter = await loadPiAdapter();
  const agentDir = adapter.paths.getAgentDir();
  const key = `${adapter.metadata.generation}:${agentDir}`;
  if (runtimeGeneration !== key) {
    runtimeGeneration = key;
    runtimePromise = null;
  }
  if (await syncLmStudioModels(agentDir)) runtimePromise = null;
  runtimePromise ??= adapter.providers.createRuntime({ cwd: await resolveStandaloneCwd(), agentDir });
  return { adapter, runtime: await runtimePromise, agentDir };
}

type ConfiguredProvider = {
  name?: string;
  baseUrl?: string;
  api?: string;
  models?: unknown[];
};

function configuredProviders(agentDir: string): Record<string, ConfiguredProvider> {
  try {
    const doc = JSON.parse(readFileSync(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers?: Record<string, ConfiguredProvider>;
    };
    return doc.providers ?? {};
  } catch {
    return {};
  }
}

function normalizeBaseUrlForApi(baseUrl: string, api: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  // Anthropic's SDK appends /v1/messages itself; storing a /v1 suffix would
  // produce /v1/v1/messages at request time.
  return api === 'anthropic-messages' ? base.replace(/\/v1$/i, '') : base;
}

async function updateConfiguredProvider(
  agentDir: string,
  providerId: string,
  update: (provider: Record<string, unknown>, providers: Record<string, unknown>) => void,
): Promise<boolean> {
  let found = false;
  const adapter = await loadPiAdapter();
  await adapter.settings.updateJson(agentDir, 'models.json', (doc) => {
    const providers = doc.providers && typeof doc.providers === 'object' && !Array.isArray(doc.providers)
      ? doc.providers as Record<string, unknown>
      : {};
    doc.providers = providers;
    const provider = providers[providerId];
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return;
    found = true;
    update(provider as Record<string, unknown>, providers);
  });
  return found;
}

async function probeResponsesBaseUrl(options: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
}): Promise<string | undefined> {
  const base = options.baseUrl.replace(/\/+$/, '');
  const candidates = /\/v1$/i.test(base) ? [base] : [base, `${base}/v1`];
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: options.model, input: 'ping', max_output_tokens: 1 }),
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (contentType.includes('text/event-stream')) return candidate;
      if (!contentType.includes('json')) continue;
      const text = await response.text();
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        if (Object.keys(json).length > 0) return candidate;
      } catch { /* A successful HTML/text page is not a Responses endpoint. */ }
    } catch { /* Keep the provider's existing working protocol. */ }
  }
  return undefined;
}

async function syncConfiguredCatalogs(
  adapter: Awaited<ReturnType<typeof loadPiAdapter>>,
  runtime: ModelRuntime,
  agentDir: string,
  onlyProviderIds?: readonly string[],
): Promise<{ discovered: number; added: number; migrated: number; changed: boolean; errors: string[] }> {
  const configured = configuredProviders(agentDir);
  const selected = onlyProviderIds ? new Set(onlyProviderIds) : null;
  let discovered = 0;
  let added = 0;
  let changed = false;
  let migrated = 0;
  const errors: string[] = [];
  for (const [providerId, provider] of Object.entries(configured)) {
    if (selected && !selected.has(providerId)) continue;
    if (!provider.baseUrl || isLmStudioProvider(providerId, provider as Record<string, unknown>)) continue;
    const model = adapter.providers.getModels(runtime, providerId)[0];
    const api = provider.api ?? model?.api;
    if (!api) continue;
    try {
      const modelHandle = model ? adapter.providers.getModel(runtime, providerId, model.id) : null;
      const resolution = modelHandle
        ? await adapter.providers.getAuth(runtime, modelHandle)
        : await adapter.providers.getAuth(runtime, providerId);
      if (!resolution) continue;
      const headers = Object.fromEntries(
        Object.entries(resolution.auth.headers ?? {})
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      const result = await syncConfiguredProviderModels({
        agentDir,
        providerId,
        api,
        auth: {
          apiKey: resolution.auth.apiKey,
          baseUrl: resolution.auth.baseUrl,
          headers,
        },
      });
      if (result) {
        discovered += result.discovered;
        added += result.added;
        changed ||= result.changed;
      }
      if (api !== 'openai-responses' && model) {
        const responsesBaseUrl = await probeResponsesBaseUrl({
          baseUrl: provider.baseUrl,
          model: model.id,
          apiKey: resolution.auth.apiKey,
          headers,
        });
        if (responsesBaseUrl) {
          await updateConfiguredProvider(agentDir, providerId, (storedProvider) => {
            storedProvider.api = 'openai-responses';
            storedProvider.baseUrl = responsesBaseUrl;
            storedProvider.compat = {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
            };
          });
          changed = true;
          migrated += 1;
        }
      }
    } catch (error) {
      errors.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { discovered, added, migrated, changed, errors };
}

function providerLabel(id: string, name: string, baseUrl?: string): string {
  if (/lm[ -]?studio/i.test(id) || /lm[ -]?studio/i.test(name)) return 'LM Studio';
  if (baseUrl) {
    try {
      const host = new URL(baseUrl).hostname;
      const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
      if (host && (!local || id.toLowerCase() === 'relay')) return host;
    } catch { /* retain the pi provider name */ }
  }
  return name || id;
}

/** 凭证变化后调用：下次使用时重建 ModelRuntime。 */
export function invalidateModelRuntime(): void {
  runtimePromise = null;
}

/** 无活动会话时建独立 SettingsManager 需要的 cwd（global settings 只依赖 agentDir，cwd 仅为构造参数）。 */
async function resolveStandaloneCwd(): Promise<string> {
  const workspace = await settingsApi
    .get({ key: 'workspaceCwd' })
    .catch(() => undefined);
  return workspace ?? os.homedir();
}

export const providersApi = {
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiProviderListResult> => {
    const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
    const configuredProvidersById = configuredProviders(agentDir);
    const extensionProviderIds = new Set(adapter.providers.getRegisteredProviderIds(runtime));
    const rows: PiProviderRow[] = [];
    for (const provider of adapter.providers.listProviders(runtime)) {
      let configured = false;
      try {
        configured = adapter.providers.hasConfiguredAuth(runtime, provider.id);
      } catch {
        configured = false;
      }
      const auth = provider.auth as { apiKey?: unknown; oauth?: unknown };
      rows.push({
        id: provider.id,
        name: providerLabel(provider.id, provider.name, configuredProvidersById[provider.id]?.baseUrl),
        baseUrl: configuredProvidersById[provider.id]?.baseUrl ?? provider.baseUrl,
        source: extensionProviderIds.has(provider.id)
          ? 'extension'
          : configuredProvidersById[provider.id]
            ? 'config'
            : 'builtin',
        authMethods: [auth.apiKey ? 'api_key' : null, auth.oauth ? 'oauth' : null].filter(
          (m): m is string => m !== null,
        ),
        configured,
        modelCount: adapter.providers.getModels(runtime, provider.id).length,
      });
    }
    return { providers: rows };
  },

  listModels: async (_payload?: unknown, ctx?: HostActionContext) => {
    const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
    const configuredProvidersById = configuredProviders(agentDir);
    const providerNames = new Map(adapter.providers.listProviders(runtime).map((provider) => [provider.id, provider.name]));
    const available = await adapter.providers.getAvailable(runtime);
    return {
      models: available.map((m) => ({
        provider: m.provider,
        providerLabel: providerLabel(
          m.provider,
          providerNames.get(m.provider) ?? m.provider,
          configuredProvidersById[m.provider]?.baseUrl,
        ),
        id: m.id,
        name: m.name,
        api: m.api,
        reasoning: m.reasoning,
        input: m.input,
        contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: m.maxTokens,
        cost: {
          input: m.cost?.input ?? 0,
          output: m.cost?.output ?? 0,
          cacheRead: m.cost?.cacheRead ?? 0,
          cacheWrite: m.cost?.cacheWrite ?? 0,
        },
      })),
    };
  },

  refresh: async (_payload?: unknown, ctx?: HostActionContext) => {
    const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
    const signal = AbortSignal.timeout(15_000);
    try {
      const configured = await syncConfiguredCatalogs(adapter, runtime, agentDir);
      const result = await adapter.providers.refresh(runtime, { allowNetwork: true, force: true, signal });
      const errors = [
        ...configured.errors,
        ...[...result.errors].map(([providerId, error]) => `${providerId}: ${error.message}`),
      ];
      return {
        success: errors.length === 0 && !result.aborted,
        discoveredModels: configured.discovered,
        addedModels: configured.added,
        migratedProviders: configured.migrated,
        ...(result.aborted ? { aborted: true, error: 'model refresh timed out' } : {}),
        ...(errors.length > 0 ? { errors, error: errors.join('\n') } : {}),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  setApiKey: async (payload: PiProviderSetKeyPayload, ctx?: HostActionContext): Promise<PiProviderSetKeyResult> => {
    const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
    try {
      // login('api_key') 的 interaction.prompt 直接回传 GUI 录入的 key；
      // 持久化由 pi auth-storage 完成
      await adapter.providers.login(runtime, payload.providerId, 'api_key', {
        prompt: async () => payload.apiKey,
        notify: () => {},
      });
      const configured = await syncConfiguredCatalogs(
        adapter,
        runtime,
        agentDir,
        [payload.providerId],
      );
      if (configured.changed) {
        await adapter.providers.refresh(runtime, { allowNetwork: false });
      }
      return {
        success: true,
        discoveredModels: configured.discovered,
        addedModels: configured.added,
        ...(configured.errors.length > 0 ? { discoveryError: configured.errors.join('\n') } : {}),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removeCredential: async (payload: { providerId: string }, ctx?: HostActionContext): Promise<HostSuccess> => {
    const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
    try {
      await adapter.providers.logout(runtime, payload.providerId);
      await updateConfiguredProvider(agentDir, payload.providerId, (provider) => {
        delete provider.apiKey;
        if (Array.isArray(provider.models)) provider.models = [];
      });
      invalidateModelRuntime();
      await adapter.providers.refresh(runtime, { allowNetwork: false });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  deleteCustom: async (payload: { providerId: string }, ctx?: HostActionContext): Promise<HostSuccess> => {
    const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
    try {
      const configured = configuredProviders(agentDir);
      if (!configured[payload.providerId]) {
        return { success: false, error: `custom provider not found: ${payload.providerId}` };
      }
      await adapter.providers.logout(runtime, payload.providerId);
      await updateConfiguredProvider(agentDir, payload.providerId, (_provider, providers) => {
        delete providers[payload.providerId];
      });
      invalidateModelRuntime();
      await adapter.providers.refresh(runtime, { allowNetwork: false });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** OAuth：pi 的 provider-owned 流程；授权 URL 等经 providers.oauthProgress 事件推给 GUI。 */
  startOAuth: async (payload: { providerId: string }, ctx?: HostActionContext): Promise<HostSuccess> => {
    const { adapter, runtime } = await getModelRuntime(ctx);
    try {
      await adapter.providers.login(runtime, payload.providerId, 'oauth', {
        prompt: async () => '',
        notify: (event) => {
          sendHostEvent('providers', 'oauthProgress', {
            providerId: payload.providerId,
            event: event as unknown as Record<string, unknown>,
          });
        },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** 自定义供应商：合并写入 <agentDir>/models.json（pi 文档定义的公开配置格式）。 */
  addCustom: async (payload: PiProviderAddCustomPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    try {
      const adapter = await loadPiAdapter();
      const agentDir = adapter.paths.getAgentDir();
      await adapter.settings.updateJson(agentDir, 'models.json', (doc) => {
        const providers = doc.providers && typeof doc.providers === 'object' && !Array.isArray(doc.providers)
          ? doc.providers as Record<string, unknown>
          : {};
        doc.providers = providers;
        providers[payload.id] = {
        baseUrl: normalizeBaseUrlForApi(payload.baseUrl, payload.api),
        api: payload.api,
        // 第三方 OpenAI 兼容服务器（vLLM/SGLang/Ollama/LM Studio 等）普遍不接受
        // developer role 与 reasoning_effort 参数：推理模型（Qwen3 等）直接 400。
        // 自定义供应商缺省声明关闭，pi 改发 system role；需要 developer role 的
        // 网关可在 models.json 手动改回 true。
        ...(payload.api === 'openai-completions' || payload.api === 'openai-responses'
          ? { compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }
          : {}),
        // 第三方模型缺省按支持推理处理：思考深度菜单可用；网关拒绝思考参数时
        // 用户可在 Models 页逐模型关闭。
        models: payload.models.map((m) => {
          const profile = matchModelProfile(m.id);
          return {
            id: m.id,
            name: m.name ?? m.id,
            reasoning: m.reasoning ?? true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow ?? profile.contextWindow,
            maxTokens: m.maxTokens ?? profile.maxTokens,
          };
        }),
        };
      });
      invalidateModelRuntime();
      const active = await resolveRuntimeForContextReady(ctx);
      const { runtime } = await getModelRuntime(ctx);
      if (active) await adapter.providers.refresh(runtime, { allowNetwork: false });
      if (payload.apiKey) {
        await adapter.providers.login(runtime, payload.id, 'api_key', {
          prompt: async () => payload.apiKey!,
          notify: () => {},
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /**
   * 切换 models.json 自定义模型的 reasoning 声明。目录探测普遍不上报推理能力，
   * 用户由此手动声明；活动会话正在使用该模型时用 pi 原生 setModel 重新应用定义，
   * 思考深度菜单立即恢复可用。
   */
  setModelReasoning: async (payload: PiProviderSetModelReasoningPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    try {
      const adapter = await loadPiAdapter();
      const agentDir = adapter.paths.getAgentDir();
      let found = false;
      const providerExists = await updateConfiguredProvider(agentDir, payload.providerId, (provider) => {
        const models = Array.isArray(provider.models) ? provider.models : [];
        for (const raw of models) {
          const model = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;
          if (model && model.id === payload.modelId) {
            model.reasoning = payload.reasoning;
            found = true;
          }
        }
      });
      if (!providerExists) {
        return { success: false, error: `custom provider not found: ${payload.providerId}` };
      }
      if (!found) {
        return { success: false, error: `model not found: ${payload.providerId}/${payload.modelId}` };
      }
      invalidateModelRuntime();
      const active = await resolveRuntimeForContextReady(ctx);
      if (active) {
        await active.adapter.providers.refresh(active.modelRuntimeHandle, { allowNetwork: false });
        const current = active.adapterRuntime.session.model;
        if (current?.provider === payload.providerId && current?.id === payload.modelId) {
          const result = await piRuntimeApi.setModel({ provider: payload.providerId, id: payload.modelId }, ctx);
          if (!result.success) return { success: false, error: result.error };
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Probe wire protocols with tiny requests. This is deliberately raw fetch: it is a
   * connection diagnostic and must not create a pi session or mutate provider state. */
  probe: async (payload: PiProviderProbePayload): Promise<PiProviderProbeResult> => {
    const base = payload.baseUrl.replace(/\/+$/, '');
    const openAiBases = /\/v1$/i.test(base) ? [base] : [base, `${base}/v1`];
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (payload.apiKey) {
      headers.authorization = `Bearer ${payload.apiKey}`;
      headers['x-api-key'] = payload.apiKey;
    }
    const readJson = async (response: Response): Promise<Record<string, unknown>> => {
      const text = await response.text();
      try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
    };
    const isProtocolPayload = (response: Response, json: Record<string, unknown>): boolean => {
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (contentType.includes('text/html')) return false;
      return contentType.includes('text/event-stream')
        || (contentType.includes('json') && Object.keys(json).length > 0);
    };
    const hasCache = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(hasCache);
      const record = value as Record<string, unknown>;
      return Object.entries(record).some(([key, child]) =>
        /cached[_-]?tokens|cacheRead|cache_read|cache[_-]?read/i.test(key) && Number(child) > 0,
      ) || Object.values(record).some(hasCache);
    };
    const models: string[] = [];
    const modelDetails: Array<{ id: string; contextWindow?: number }> = [];
    const advertisedEndpointTypes = new Set<string>();
    for (const candidateBase of openAiBases) {
      try {
        const response = await fetch(`${candidateBase}/models`, { headers, signal: AbortSignal.timeout(9000) });
        if (!response.ok) continue;
        const json = await readJson(response);
        const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
        if (rows.length === 0) continue;
        for (const raw of rows) {
          if (!raw || typeof raw !== 'object') continue;
          const row = raw as Record<string, unknown>;
          const id = String(row.id ?? row.name ?? '');
          if (!id) continue;
          models.push(id);
          const contextWindow = Number(
            row.contextWindow ?? row.context_window ?? row.context_length
              ?? row.max_context_length ?? row.max_model_len ?? 0,
          );
          if (contextWindow > 0) modelDetails.push({ id, contextWindow });
          const endpointTypes = Array.isArray(row.supported_endpoint_types)
            ? row.supported_endpoint_types
            : [];
          for (const endpointType of endpointTypes) advertisedEndpointTypes.add(String(endpointType));
        }
        break;
      } catch { /* Try the next conventional OpenAI base URL. */ }
    }
    // LM Studio's OpenAI-compatible /models currently omits loaded context metadata.
    // Its native endpoint exposes both the model maximum and the active instance value.
    try {
      const nativeBase = base.replace(/\/v1$/, '');
      const response = await fetch(`${nativeBase}/api/v1/models`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        const json = await readJson(response);
        const rows = Array.isArray(json.models) ? json.models : Array.isArray(json.data) ? json.data : [];
        for (const raw of rows) {
          if (!raw || typeof raw !== 'object') continue;
          const row = raw as Record<string, unknown>;
          const id = String(row.key ?? row.id ?? row.model ?? '');
          if (!id) continue;
          const instances = Array.isArray(row.loaded_instances) ? row.loaded_instances : [];
          const first = instances[0] as { config?: { context_length?: unknown } } | undefined;
          const loaded = Number(first?.config?.context_length ?? 0);
          const maximum = Number(row.max_context_length ?? 0);
          modelDetails.push({ id, ...(loaded > 0 || maximum > 0 ? { contextWindow: loaded || maximum } : {}) });
          if (!models.includes(id)) models.push(id);
        }
      }
    } catch { /* Native metadata is optional and only available on LM Studio. */ }
    const model = payload.model || models[0] || 'test-model';
    // 目录未上报上下文的模型补上前缀规格表（探测不出时给用户一个合理的默认展示）。
    for (const modelId of models) {
      if (!modelDetails.some((detail) => detail.id === modelId)) {
        modelDetails.push({ id: modelId, contextWindow: matchModelProfile(modelId).contextWindow });
      }
    }
    const protocols: PiProviderProbeResult['protocols'] = [];
    const resolvedBaseUrls = new Map<string, string>();
    const anthropicUrl = /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
    type ProbeCandidate = { url: string; resolvedBaseUrl: string };
    const requests: Array<{ api: string; candidates: ProbeCandidate[]; body: Record<string, unknown>; headers?: Record<string, string> }> = [
      {
        api: 'openai-completions',
        candidates: openAiBases.map((candidateBase) => ({ url: `${candidateBase}/chat/completions`, resolvedBaseUrl: candidateBase })),
        body: { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
      },
      {
        api: 'openai-responses',
        candidates: openAiBases.map((candidateBase) => ({ url: `${candidateBase}/responses`, resolvedBaseUrl: candidateBase })),
        body: { model, input: 'ping', max_output_tokens: 1 },
      },
      {
        api: 'anthropic-messages',
        candidates: [{ url: anthropicUrl, resolvedBaseUrl: normalizeBaseUrlForApi(base, 'anthropic-messages') }],
        body: { model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
        headers: { ...headers, 'anthropic-version': '2023-06-01' },
      },
      {
        api: 'google-generative-ai',
        candidates: [{ url: `${base}/models/${encodeURIComponent(model)}:generateContent`, resolvedBaseUrl: base }],
        body: { contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } },
      },
    ];
    for (const request of requests) {
      let available = false;
      let cacheStats = false;
      let error: string | undefined;
      for (const candidate of request.candidates) {
        try {
          const first = await fetch(candidate.url, { method: 'POST', headers: request.headers ?? headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(9000) });
          const firstJson = await readJson(first);
          available = first.ok && isProtocolPayload(first, firstJson);
          cacheStats = hasCache(firstJson);
          error = first.ok
            ? `unexpected content-type: ${first.headers.get('content-type') ?? 'unknown'}`
            : `HTTP ${first.status}`;
          if (!available) continue;
          const second = await fetch(candidate.url, { method: 'POST', headers: request.headers ?? headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(9000) });
          cacheStats ||= hasCache(await readJson(second));
          resolvedBaseUrls.set(request.api, candidate.resolvedBaseUrl);
          error = undefined;
          break;
        } catch (candidateError) {
          error = candidateError instanceof Error ? candidateError.message : String(candidateError);
        }
      }
      protocols.push({
        api: request.api,
        available,
        cacheStats,
        ...(error ? { error } : {}),
        ...(available ? { resolvedBaseUrl: resolvedBaseUrls.get(request.api) } : {}),
      });
    }
    const advertisedProtocols = protocols.filter((protocol) =>
      advertisedEndpointTypes.has(protocol.api)
      || (advertisedEndpointTypes.has('openai') && protocol.api.startsWith('openai-'))
      || (advertisedEndpointTypes.has('anthropic') && protocol.api === 'anthropic-messages')
      || (advertisedEndpointTypes.has('google') && protocol.api === 'google-generative-ai'),
    );
    const candidates = advertisedProtocols.some((protocol) => protocol.available)
      ? advertisedProtocols
      : protocols;
    const protocolPreference = [
      'openai-responses',
      'openai-completions',
      'anthropic-messages',
      'google-generative-ai',
    ];
    const recommended = protocolPreference
      .map((api) => candidates.find((protocol) => protocol.api === api && protocol.available))
      .find(Boolean);
    return {
      models,
      modelDetails,
      protocols,
      recommendedApi: recommended?.api,
      recommendedBaseUrl: recommended ? resolvedBaseUrls.get(recommended.api) : undefined,
    };
  },

  getCompaction: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiCompactionSettings> => {
    const active = resolveRuntimeForContext(ctx);
    const adapter = await loadPiAdapter();
    const handle = active?.settingsHandle ?? adapter.settings.open({ cwd: await resolveStandaloneCwd(), agentDir: adapter.paths.getAgentDir() });
    return adapter.settings.getCompaction(handle);
  },

  setCompaction: async (payload: { reserveTokens?: number; keepRecentTokens?: number; enabled?: boolean }): Promise<HostSuccess> => {
    try {
      const adapter = await loadPiAdapter();
      const agentDir = adapter.paths.getAgentDir();
      await adapter.settings.updateJson(agentDir, 'settings.json', (doc) => {
        const current = doc.compaction && typeof doc.compaction === 'object' ? doc.compaction as Record<string, unknown> : {};
        doc.compaction = { ...current, ...(payload.enabled === undefined ? {} : { enabled: payload.enabled }), ...(payload.reserveTokens === undefined ? {} : { reserveTokens: payload.reserveTokens }), ...(payload.keepRecentTokens === undefined ? {} : { keepRecentTokens: payload.keepRecentTokens }) };
      });
      await reloadRuntimeSettings();
      return { success: true };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  },

  getDefaultModel: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiDefaultModelResult> => {
    try {
      const active = resolveRuntimeForContext(ctx);
      const adapter = await loadPiAdapter();
      const handle = active?.settingsHandle ?? adapter.settings.open({ cwd: await resolveStandaloneCwd(), agentDir: adapter.paths.getAgentDir() });
      return { model: adapter.settings.getDefaultModel(handle) };
    } catch { return { model: null }; }
  },

  setDefaultModel: async (payload: PiDefaultModel, ctx?: HostActionContext): Promise<HostSuccess> => {
    const active = await resolveRuntimeForContextReady(ctx);
    if (active) return piRuntimeApi.setModel(payload, ctx);
    try {
      const { adapter, runtime, agentDir } = await getModelRuntime(ctx);
      if (!adapter.providers.getModel(runtime, payload.provider, payload.id)) return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
      const handle = adapter.settings.open({ cwd: await resolveStandaloneCwd(), agentDir });
      adapter.settings.setDefaultModel(handle, payload);
      await adapter.settings.flush(handle);
      return { success: true };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  },

  getRetry: async (): Promise<PiRetrySettingsResult> => {
    const adapter = await loadPiAdapter();
    const handle = adapter.settings.open({ cwd: await resolveStandaloneCwd(), agentDir: adapter.paths.getAgentDir() });
    return adapter.settings.getRetry(handle);
  },

  setRetry: async (payload: PiRetrySettingsPayload): Promise<HostSuccess> => {
    try {
      const adapter = await loadPiAdapter();
      await adapter.settings.updateJson(adapter.paths.getAgentDir(), 'settings.json', (doc) => {
        const current = doc.retry && typeof doc.retry === 'object' ? doc.retry as Record<string, unknown> : {};
        doc.retry = { ...current, ...(payload.enabled === undefined ? {} : { enabled: payload.enabled }), ...(payload.maxRetries === undefined ? {} : { maxRetries: payload.maxRetries }), ...(payload.baseDelayMs === undefined ? {} : { baseDelayMs: payload.baseDelayMs }) };
      });
      return { success: true };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  },

  getDefaultThinking: async (): Promise<PiDefaultThinkingResult> => {
    const adapter = await loadPiAdapter();
    const handle = adapter.settings.open({ cwd: await resolveStandaloneCwd(), agentDir: adapter.paths.getAgentDir() });
    return { level: adapter.settings.getDefaultThinking(handle) };
  },

  setDefaultThinking: async (payload: { level: string }): Promise<HostSuccess> => {
    try {
      const adapter = await loadPiAdapter();
      const handle = adapter.settings.open({ cwd: await resolveStandaloneCwd(), agentDir: adapter.paths.getAgentDir() });
      adapter.settings.setDefaultThinking(handle, payload.level);
      await adapter.settings.flush(handle);
      return { success: true };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  },
};
