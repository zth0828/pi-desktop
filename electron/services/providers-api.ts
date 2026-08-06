// providers 模块：pi ModelRuntime 的封装（供应商枚举、认证状态、key 录入、OAuth、
// 自定义供应商）。key 存取全程经 pi 的 auth-storage（login/logout），壳不写 auth.json。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  HostSuccess,
  PiProviderAddCustomPayload,
  PiProviderListResult,
  PiProviderRow,
  PiProviderSetKeyPayload,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';

type ModelRuntime = Awaited<ReturnType<PiSdk['ModelRuntime']['create']>>;

let runtimePromise: Promise<ModelRuntime> | null = null;

async function getModelRuntime(): Promise<{ sdk: PiSdk; runtime: ModelRuntime }> {
  const sdk = await loadPiSdk();
  runtimePromise ??= sdk.ModelRuntime.create();
  return { sdk, runtime: await runtimePromise };
}

/** 凭证变化后调用：下次使用时重建 ModelRuntime。 */
export function invalidateModelRuntime(): void {
  runtimePromise = null;
}

export const providersApi = {
  list: async (): Promise<PiProviderListResult> => {
    const { runtime } = await getModelRuntime();
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
        name: provider.name,
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
    const { runtime } = await getModelRuntime();
    const available = await runtime.getAvailable();
    return {
      models: available.map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      })),
    };
  },

  setApiKey: async (payload: PiProviderSetKeyPayload): Promise<HostSuccess> => {
    const { runtime } = await getModelRuntime();
    try {
      // login('api_key') 的 interaction.prompt 直接回传 GUI 录入的 key；
      // 持久化由 pi auth-storage 完成
      await runtime.login(payload.providerId, 'api_key', {
        prompt: async () => payload.apiKey,
        notify: () => {},
      });
      return { success: true };
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
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
