// proxy 模块：把 Pi Desktop 的代理设置（auto/off）应用到 pi 的全局
// undici dispatcher。auto 直接使用壳内配置的 URL，默认 127.0.0.1:7897；
// 不读取系统代理或 pi settings.json。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_DESKTOP_PROXY_URL,
  type ProxyApplyResult,
  type ProxyDetection,
  type ProxyMode,
} from '@shared/host-api/contract';
import { settingsApi } from './settings-api';

export type ResolvedProxy = {
  url?: string;
  source: ProxyDetection['source'];
};

/** 清除启动环境继承的代理，让 Pi Desktop 设置成为唯一来源。 */
export function clearProxyEnvironment(): void {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete process.env[key];
  }
}

/** 按 Pi Desktop 设置解析当前应生效的代理 URL。 */
export async function resolveProxy(): Promise<ResolvedProxy> {
  let mode: ProxyMode = 'auto';
  let configuredUrl: string | undefined;
  try {
    const snapshot = await settingsApi.getAll();
    mode = snapshot.httpProxyMode === 'off' ? 'off' : 'auto';
    configuredUrl = snapshot.httpProxyUrl;
  } catch {
    // 启动早期壳设置不可用时仍使用默认代理地址。
  }
  if (mode === 'off') return { source: 'off' };
  return {
    url: configuredUrl?.trim() || DEFAULT_DESKTOP_PROXY_URL,
    source: 'app',
  };
}

/** 当前代理模式 + Pi Desktop 中生效的 URL 快照（供设置页展示）。 */
export async function detectProxy(): Promise<ProxyDetection> {
  const snapshot: { httpProxyMode?: unknown } = await settingsApi.getAll().catch(() => ({}));
  const mode: ProxyMode = snapshot.httpProxyMode === 'off' ? 'off' : 'auto';
  const resolved = await resolveProxy();
  return {
    mode,
    ...(resolved.url ? { url: resolved.url, source: resolved.source } : { source: resolved.source }),
  };
}

/** 把当前解析出的代理应用到 pi 的全局网络栈。改设置后无需重启即生效。 */
export async function applyProxyToPi(): Promise<ProxyApplyResult> {
  const resolved = await resolveProxy();
  try {
    // 定位 pi 的 http-dispatcher（与 loader 相同的动态 import 方式）。
    const { detectPiEnvironment } = await import('../utils/pi-detector');
    const environment = detectPiEnvironment();
    if (!environment.pi.found || !environment.pi.packageRoot) {
      return { success: false, error: 'pi is not installed' };
    }
    const mod = await import(pathToFileURL(
      path.join(environment.pi.packageRoot, 'dist', 'core', 'http-dispatcher.js'),
    ).href) as {
      applyHttpProxySettings?: (proxy?: string) => void;
      configureHttpDispatcher?: (timeoutMs?: number) => void;
    };
    // 软件设置必须覆盖启动环境中的代理；关闭时也要清掉继承的环境变量。
    clearProxyEnvironment();
    mod.applyHttpProxySettings?.(resolved.url);
    mod.configureHttpDispatcher?.();
    return resolved.url
      ? { success: true, detail: `${resolved.source}: ${resolved.url}` }
      : { success: true, detail: resolved.source };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const proxyApi = {
  detect: async (): Promise<ProxyDetection> => detectProxy(),
  apply: async (): Promise<ProxyApplyResult> => applyProxyToPi(),
};
