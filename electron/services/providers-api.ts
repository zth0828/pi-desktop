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
  PiProviderSetKeyResult,
  PiCompactionSettings,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';
import { isLmStudioProvider, syncLmStudioModels } from '../utils/lmstudio-models';
import { syncConfiguredProviderModels } from '../utils/configured-provider-models';
import { getActiveRuntime, getActiveRuntimeReady, piRuntimeApi } from './pi-runtime-api';
import { settingsApi } from './settings-api';

type ModelRuntime = Awaited<ReturnType<PiSdk['ModelRuntime']['create']>>;

let runtimePromise: Promise<ModelRuntime> | null = null;

async function getModelRuntime(): Promise<{ sdk: PiSdk; runtime: ModelRuntime }> {
  const active = await getActiveRuntimeReady();
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
  list: async (): Promise<PiProviderListResult> => {
    const { sdk, runtime } = await getModelRuntime();
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

  listModels: async () => {
    const { sdk, runtime } = await getModelRuntime();
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

  refresh: async () => {
    const { sdk, runtime } = await getModelRuntime();
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

  setApiKey: async (payload: PiProviderSetKeyPayload): Promise<PiProviderSetKeyResult> => {
    const { sdk, runtime } = await getModelRuntime();
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

  removeCredential: async (payload: { providerId: string }): Promise<HostSuccess> => {
    const { runtime } = await getModelRuntime();
    try {
      await runtime.logout(payload.providerId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** OAuth：pi 的 provider-owned 流程；授权 URL 等经 providers.oauthProgress 事件推给 GUI。 */
  startOAuth: async (payload: { providerId: string }): Promise<HostSuccess> => {
    const { runtime } = await getModelRuntime();
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
  addCustom: async (payload: PiProviderAddCustomPayload): Promise<HostSuccess> => {
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
        baseUrl: payload.baseUrl,
        api: payload.api,
        ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
        models: payload.models.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          reasoning: m.reasoning ?? false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
          ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        })),
      };
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(modelsPath, JSON.stringify(doc, null, 2));
      invalidateModelRuntime();
      const active = await getActiveRuntimeReady();
      if (active) await active.runtime.services.modelRuntime.refresh({ allowNetwork: false });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Probe wire protocols with tiny requests. This is deliberately raw fetch: it is a
   * connection diagnostic and must not create a pi session or mutate provider state. */
  probe: async (payload: PiProviderProbePayload): Promise<PiProviderProbeResult> => {
    const base = payload.baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (payload.apiKey) {
      headers.authorization = `Bearer ${payload.apiKey}`;
      headers['x-api-key'] = payload.apiKey;
    }
    const readJson = async (response: Response): Promise<Record<string, unknown>> => {
      const text = await response.text();
      try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
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
    try {
      const response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(9000) });
      if (response.ok) {
        const json = await readJson(response);
        const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
        for (const row of rows) {
          const id = typeof row === 'object' && row ? String((row as Record<string, unknown>).id ?? '') : '';
          if (id) models.push(id);
        }
      }
    } catch { /* each protocol result reports its own failure */ }
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
    const requests: Array<{ api: string; url: string; body: Record<string, unknown>; headers?: Record<string, string> }> = [
      { api: 'openai-completions', url: `${base}/chat/completions`, body: { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 } },
      { api: 'openai-responses', url: `${base}/responses`, body: { model, input: 'ping', max_output_tokens: 1 } },
      { api: 'anthropic-messages', url: `${base.replace(/\/v1$/, '')}/messages`, body: { model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }, headers: { ...headers, 'anthropic-version': '2023-06-01' } },
      { api: 'google-generative-ai', url: `${base}/models/${encodeURIComponent(model)}:generateContent`, body: { contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } } },
    ];
    for (const request of requests) {
      try {
        const first = await fetch(request.url, { method: 'POST', headers: request.headers ?? headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(9000) });
        const firstJson = await readJson(first);
        let cacheStats = hasCache(firstJson);
        if (first.ok) {
          const second = await fetch(request.url, { method: 'POST', headers: request.headers ?? headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(9000) });
          cacheStats ||= hasCache(await readJson(second));
        }
        protocols.push({ api: request.api, available: first.ok, cacheStats, error: first.ok ? undefined : `HTTP ${first.status}` });
      } catch (error) {
        protocols.push({ api: request.api, available: false, cacheStats: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const recommendedApi = protocols.find((p) => p.available && p.cacheStats)?.api
      ?? protocols.find((p) => p.available)?.api;
    return { models, modelDetails, protocols, recommendedApi };
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
  getDefaultModel: async (): Promise<PiDefaultModelResult> => {
    try {
      const active = getActiveRuntime();
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
  setDefaultModel: async (payload: PiDefaultModel): Promise<HostSuccess> => {
    const active = await getActiveRuntimeReady();
    if (active) return piRuntimeApi.setModel(payload);
    try {
      const sdk = await loadPiSdk();
      const { runtime } = await getModelRuntime();
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
