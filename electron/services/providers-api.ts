// providers 模块：pi ModelRuntime 的封装（供应商枚举、认证状态、key 录入、OAuth、
// 自定义供应商）。key 存取全程经 pi 的 auth-storage（login/logout），壳不写 auth.json。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';
import { isLmStudioProvider, syncLmStudioModels } from '../utils/lmstudio-models';
import { syncConfiguredProviderModels } from '../utils/configured-provider-models';
import {
  piRuntimeApi,
  resolveRuntimeForContext,
  resolveRuntimeForContextReady,
} from './pi-runtime-api';
import type { HostActionContext } from '../main/ipc/host-contract';
import { settingsApi } from './settings-api';

type ModelRuntime = Awaited<ReturnType<PiSdk['ModelRuntime']['create']>>;

let runtimePromise: Promise<ModelRuntime> | null = null;

async function getModelRuntime(ctx?: HostActionContext): Promise<{ sdk: PiSdk; runtime: ModelRuntime }> {
  const active = await resolveRuntimeForContextReady(ctx);
  if (active) {
    return { sdk: active.sdk, runtime: active.runtime.services.modelRuntime };
  }
  const sdk = await loadPiSdk();
  if (await syncLmStudioModels(sdk.getAgentDir())) runtimePromise = null;
  runtimePromise ??= sdk.ModelRuntime.create();
  return { sdk, runtime: await runtimePromise };
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

function updateConfiguredProvider(
  agentDir: string,
  providerId: string,
  update: (provider: Record<string, unknown>, providers: Record<string, unknown>) => void,
): boolean {
  const modelsPath = path.join(agentDir, 'models.json');
  if (!existsSync(modelsPath)) return false;
  const doc = JSON.parse(readFileSync(modelsPath, 'utf8')) as { providers?: Record<string, unknown> };
  const provider = doc.providers?.[providerId];
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return false;
  update(provider as Record<string, unknown>, doc.providers!);
  writeFileSync(modelsPath, JSON.stringify(doc, null, 2));
  return true;
}

async function syncConfiguredCatalogs(
  runtime: ModelRuntime,
  agentDir: string,
  onlyProviderIds?: readonly string[],
): Promise<{ discovered: number; added: number; changed: boolean; errors: string[] }> {
  const configured = configuredProviders(agentDir);
  const selected = onlyProviderIds ? new Set(onlyProviderIds) : null;
  let discovered = 0;
  let added = 0;
  let changed = false;
  const errors: string[] = [];
  for (const [providerId, provider] of Object.entries(configured)) {
    if (selected && !selected.has(providerId)) continue;
    if (!provider.baseUrl || isLmStudioProvider(providerId, provider as Record<string, unknown>)) continue;
    const model = runtime.getModels(providerId)[0];
    const api = provider.api ?? model?.api;
    if (!api) continue;
    try {
      const resolution = model
        ? await runtime.getAuth(model)
        : await runtime.getAuth(providerId);
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
      if (!result) continue;
      discovered += result.discovered;
      added += result.added;
      changed ||= result.changed;
    } catch (error) {
      errors.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { discovered, added, changed, errors };
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
    const { sdk, runtime } = await getModelRuntime(ctx);
    const configuredProvidersById = configuredProviders(sdk.getAgentDir());
    const extensionProviderIds = new Set(runtime.getRegisteredProviderIds());
    const rows: PiProviderRow[] = [];
    for (const provider of runtime.getProviders()) {
      let configured = false;
      try {
        configured = runtime.hasConfiguredAuth(provider.id);
      } catch {
        configured = false;
      }
      const auth = provider.auth as { apiKey?: unknown; oauth?: unknown };
      rows.push({
        id: provider.id,
        name: providerLabel(provider.id, provider.name, configuredProvidersById[provider.id]?.baseUrl),
        source: extensionProviderIds.has(provider.id)
          ? 'extension'
          : configuredProvidersById[provider.id]
            ? 'config'
            : 'builtin',
        authMethods: [auth.apiKey ? 'api_key' : null, auth.oauth ? 'oauth' : null].filter(
          (m): m is string => m !== null,
        ),
        configured,
        modelCount: runtime.getModels(provider.id).length,
      });
    }
    return { providers: rows };
  },

  listModels: async (_payload?: unknown, ctx?: HostActionContext) => {
    const { sdk, runtime } = await getModelRuntime(ctx);
    const configuredProvidersById = configuredProviders(sdk.getAgentDir());
    const providerNames = new Map(runtime.getProviders().map((provider) => [provider.id, provider.name]));
    const available = await runtime.getAvailable();
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
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        cost: { ...m.cost },
      })),
    };
  },

  refresh: async (_payload?: unknown, ctx?: HostActionContext) => {
    const { sdk, runtime } = await getModelRuntime(ctx);
    const signal = AbortSignal.timeout(15_000);
    try {
      const configured = await syncConfiguredCatalogs(runtime, sdk.getAgentDir());
      const result = await runtime.refresh({ allowNetwork: true, force: true, signal });
      const errors = [
        ...configured.errors,
        ...[...result.errors].map(([providerId, error]) => `${providerId}: ${error.message}`),
      ];
      return {
        success: errors.length === 0 && !result.aborted,
        discoveredModels: configured.discovered,
        addedModels: configured.added,
        ...(result.aborted ? { aborted: true, error: 'model refresh timed out' } : {}),
        ...(errors.length > 0 ? { errors, error: errors.join('\n') } : {}),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  setApiKey: async (payload: PiProviderSetKeyPayload, ctx?: HostActionContext): Promise<PiProviderSetKeyResult> => {
    const { sdk, runtime } = await getModelRuntime(ctx);
    try {
      // login('api_key') 的 interaction.prompt 直接回传 GUI 录入的 key；
      // 持久化由 pi auth-storage 完成
      await runtime.login(payload.providerId, 'api_key', {
        prompt: async () => payload.apiKey,
        notify: () => {},
      });
      const configured = await syncConfiguredCatalogs(
        runtime,
        sdk.getAgentDir(),
        [payload.providerId],
      );
      if (configured.changed) {
        await runtime.refresh({ allowNetwork: false });
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
    const { sdk, runtime } = await getModelRuntime(ctx);
    try {
      await runtime.logout(payload.providerId);
      updateConfiguredProvider(sdk.getAgentDir(), payload.providerId, (provider) => {
        delete provider.apiKey;
        // Config-defined models are only usable with this credential. Clear the
        // stale directory now; saving a new key discovers them again.
        if (Array.isArray(provider.models)) provider.models = [];
      });
      invalidateModelRuntime();
      await runtime.refresh({ allowNetwork: false });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  deleteCustom: async (payload: { providerId: string }, ctx?: HostActionContext): Promise<HostSuccess> => {
    const { sdk, runtime } = await getModelRuntime(ctx);
    try {
      const configured = configuredProviders(sdk.getAgentDir());
      if (!configured[payload.providerId]) {
        return { success: false, error: `custom provider not found: ${payload.providerId}` };
      }
      await runtime.logout(payload.providerId);
      updateConfiguredProvider(sdk.getAgentDir(), payload.providerId, (_provider, providers) => {
        delete providers[payload.providerId];
      });
      invalidateModelRuntime();
      await runtime.refresh({ allowNetwork: false });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** OAuth：pi 的 provider-owned 流程；授权 URL 等经 providers.oauthProgress 事件推给 GUI。 */
  startOAuth: async (payload: { providerId: string }, ctx?: HostActionContext): Promise<HostSuccess> => {
    const { runtime } = await getModelRuntime(ctx);
    try {
      await runtime.login(payload.providerId, 'oauth', {
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
      const sdk = await loadPiSdk();
      const agentDir = sdk.getAgentDir();
      const modelsPath = path.join(agentDir, 'models.json');
      let doc: { providers?: Record<string, unknown> } = {};
      if (existsSync(modelsPath)) {
        doc = JSON.parse(readFileSync(modelsPath, 'utf8'));
      }
      doc.providers ??= {};
      doc.providers[payload.id] = {
        baseUrl: normalizeBaseUrlForApi(payload.baseUrl, payload.api),
        api: payload.api,
        // 第三方模型缺省按支持推理处理：思考深度菜单可用；网关拒绝思考参数时
        // 用户可在 Models 页逐模型关闭。
        models: payload.models.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          reasoning: m.reasoning ?? true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
          ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        })),
      };
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(modelsPath, JSON.stringify(doc, null, 2));
      invalidateModelRuntime();
      const active = await resolveRuntimeForContextReady(ctx);
      const runtime = active?.runtime.services.modelRuntime ?? (await getModelRuntime(ctx)).runtime;
      if (active) await runtime.refresh({ allowNetwork: false });
      if (payload.apiKey) {
        await runtime.login(payload.id, 'api_key', {
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
      const sdk = await loadPiSdk();
      let found = false;
      const providerExists = updateConfiguredProvider(sdk.getAgentDir(), payload.providerId, (provider) => {
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
        await active.runtime.services.modelRuntime.refresh({ allowNetwork: false });
        const current = active.runtime.session.model;
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
      protocols.push({ api: request.api, available, cacheStats, ...(error ? { error } : {}) });
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
    const recommended = candidates.find((protocol) => protocol.available && protocol.cacheStats)
      ?? candidates.find((protocol) => protocol.available);
    return {
      models,
      modelDetails,
      protocols,
      recommendedApi: recommended?.api,
      recommendedBaseUrl: recommended ? resolvedBaseUrls.get(recommended.api) : undefined,
    };
  },

  getCompaction: async (): Promise<PiCompactionSettings> => {
    const sdk = await loadPiSdk();
    const settingsManager = sdk.SettingsManager.create(await resolveStandaloneCwd(), sdk.getAgentDir());
    return settingsManager.getCompactionSettings();
  },

  setCompaction: async (payload: { reserveTokens?: number; keepRecentTokens?: number; enabled?: boolean }): Promise<HostSuccess> => {
    try {
      const sdk = await loadPiSdk();
      const agentDir = sdk.getAgentDir();
      const settingsPath = path.join(agentDir, 'settings.json');
      let doc: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try { doc = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>; } catch { doc = {}; }
      }
      const current = (doc.compaction && typeof doc.compaction === 'object' ? doc.compaction : {}) as Record<string, unknown>;
      doc.compaction = {
        ...current,
        ...(payload.enabled === undefined ? {} : { enabled: payload.enabled }),
        ...(payload.reserveTokens === undefined ? {} : { reserveTokens: payload.reserveTokens }),
        ...(payload.keepRecentTokens === undefined ? {} : { keepRecentTokens: payload.keepRecentTokens }),
      };
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(doc, null, 2));
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** 首选模型 = pi settings.json 的 defaultProvider/defaultModel（新会话的初始模型来源）。 */
  getDefaultModel: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiDefaultModelResult> => {
    try {
      const active = resolveRuntimeForContext(ctx);
      const sdk = active ? null : await loadPiSdk();
      const settingsManager = active
        ? active.runtime.services.settingsManager
        : sdk!.SettingsManager.create(await resolveStandaloneCwd(), sdk!.getAgentDir());
      const provider = settingsManager.getDefaultProvider();
      const id = settingsManager.getDefaultModel();
      return { model: provider && id ? { provider, id } : null };
    } catch {
      return { model: null };
    }
  },

  /**
   * 设为首选模型。pi 原生机制：AgentSession.setModel 内部会持久化
   * defaultProvider/defaultModel（新会话经 findInitialModel 应用），
   * 所以有活动会话时直接复用 piRuntime.setModel；无会话时用独立
   * SettingsManager 写同一份 settings.json，语义完全一致。
   */
  setDefaultModel: async (payload: PiDefaultModel, ctx?: HostActionContext): Promise<HostSuccess> => {
    const active = await resolveRuntimeForContextReady(ctx);
    if (active) return piRuntimeApi.setModel(payload, ctx);
    try {
      const sdk = await loadPiSdk();
      const { runtime } = await getModelRuntime(ctx);
      if (!runtime.getModel(payload.provider, payload.id)) {
        return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
      }
      const settingsManager = sdk.SettingsManager.create(
        await resolveStandaloneCwd(),
        sdk.getAgentDir(),
      );
      settingsManager.setDefaultModelAndProvider(payload.provider, payload.id);
      await settingsManager.flush();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
