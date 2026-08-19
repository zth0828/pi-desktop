// proxy 模块：把壳的代理设置（auto/manual/off）解析成 pi 可用的代理 URL，
// 并应用到 pi 的全局 undici dispatcher。pi 官方机制是 settings.json 的 httpProxy
// 经 applyHttpProxySettings 写入 HTTP_PROXY/HTTPS_PROXY，再由 configureHttpDispatcher
// 创建 EnvHttpProxyAgent；壳不跑 pi 的 main.js，这里补上同样的两步，
// 且优先读壳设置（electron-store），不要求用户手写 pi 的配置文件。
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProxyApplyResult, ProxyDetection, ProxyMode } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { detectSystemProxy, type SystemProxyInfo } from '../utils/system-proxy';

export type ResolvedProxy = {
  url?: string;
  source: ProxyDetection['source'];
};

function readPiSettingsProxy(): { url?: string; source: 'settings' } {
  try {
    const doc = JSON.parse(readFileSync(path.join(os.homedir(), '.pi', 'agent', 'settings.json'), 'utf8')) as {
      httpProxy?: unknown;
    };
    if (typeof doc.httpProxy === 'string' && doc.httpProxy.trim()) {
      return { url: doc.httpProxy.trim(), source: 'settings' };
    }
  } catch { /* 无 settings.json 或未配置 */ }
  return { source: 'settings' };
}

/** 按壳设置解析当前应生效的代理 URL（auto 模式实时检测系统代理/端口）。 */
export async function resolveProxy(): Promise<ResolvedProxy> {
  let mode: ProxyMode = 'auto';
  let manualUrl: string | undefined;
  try {
    const snapshot = await settingsApi.getAll();
    mode = snapshot.httpProxyMode ?? 'auto';
    manualUrl = snapshot.httpProxyUrl;
  } catch { /* 壳设置不可用（如启动早期）：回退 auto */ }
  if (mode === 'off') return { source: 'off' };
  if (mode === 'manual') {
    return manualUrl?.trim() ? { url: manualUrl.trim(), source: 'manual' } : { source: 'none' };
  }
  const detected: SystemProxyInfo | null = await detectSystemProxy();
  if (detected) return detected;
  return readPiSettingsProxy();
}

/** 当前代理模式 + 生效 URL 快照（供设置页展示）。 */
export async function detectProxy(): Promise<ProxyDetection> {
  let mode: ProxyMode = 'auto';
  try {
    mode = (await settingsApi.getAll()).httpProxyMode ?? 'auto';
  } catch { /* 同上 */ }
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
