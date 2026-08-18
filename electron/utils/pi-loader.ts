// pi SDK 加载器：兼容历史调用方，真正的运行时加载和能力检查由 Pi Adapter 负责。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPiAdapter, PiAdapterNotReadyError, invalidatePiAdapterCache } from '../services/pi-adapter';
import { detectPiEnvironment } from './pi-detector';

export type PiSdk = typeof import('@earendil-works/pi-coding-agent');
export const PiNotReadyError = PiAdapterNotReadyError;

let cachedProjectTrust: Promise<PiProjectTrustModule> | null = null;
let cachedProjectTrustRoot: string | null = null;
let cachedToolsManager: Promise<PiToolsManagerModule> | null = null;
let cachedToolsManagerRoot: string | null = null;

export async function loadPiSdk(): Promise<PiSdk> {
  return (await loadPiAdapter()).sdk;
}

/** pi 被安装/升级后调用：下次 loadPiSdk 重新解析。 */
export function invalidatePiSdkCache(): void {
  invalidatePiAdapterCache();
  cachedProjectTrust = null;
  cachedProjectTrustRoot = null;
  cachedToolsManager = null;
  cachedToolsManagerRoot = null;
}


// resolveProjectTrusted 未从包根导出（package exports 只放行 "."），
// 与 loadPiSdk 一样按文件 URL 直取包内文件；布局变化由能力/契约测试暴露。
export type PiProjectTrustModule = {
  resolveProjectTrusted: (options: {
    cwd: string;
    trustStore: InstanceType<PiSdk['ProjectTrustStore']>;
    trustOverride?: boolean;
    defaultProjectTrust?: import('@earendil-works/pi-coding-agent').DefaultProjectTrust;
    extensionsResult?: unknown;
    projectTrustContext: {
      cwd: string;
      mode: 'tui' | 'rpc' | 'json' | 'print';
      hasUI: boolean;
      ui: {
        select: (title: string, options: string[]) => Promise<string | undefined>;
        confirm: (title: string, message?: string) => Promise<boolean>;
        input: (title: string, placeholder?: string) => Promise<string | undefined>;
        notify: (message: string, type?: 'info' | 'warning' | 'error') => void;
      };
    };
    onExtensionError?: (message: string) => void;
  }) => Promise<boolean>;
};

export type PiToolsManagerModule = {
  /** pi TUI 的 fd/rg 解析：优先系统已装，缺失时下载到 pi bin 目录。 */
  ensureTool: (tool: 'fd' | 'rg', silent?: boolean) => Promise<string>;
};

/** tools-manager 未从包根导出，与 loadPiProjectTrust 同款按文件 URL 加载。 */
export async function loadPiToolsManager(): Promise<PiToolsManagerModule> {
  const env = detectPiEnvironment();
  if (!env.pi.found || !env.pi.packageRoot) throw new PiNotReadyError('not-installed');
  if (cachedToolsManager && cachedToolsManagerRoot === env.pi.packageRoot) return cachedToolsManager;
  cachedToolsManagerRoot = env.pi.packageRoot;
  cachedToolsManager = import(
    pathToFileURL(path.join(env.pi.packageRoot, 'dist/utils/tools-manager.js')).href
  ) as Promise<PiToolsManagerModule>;
  try {
    await cachedToolsManager;
  } catch (err) {
    cachedToolsManager = null;
    cachedToolsManagerRoot = null;
    throw err;
  }
  return cachedToolsManager;
}

export async function loadPiProjectTrust(): Promise<PiProjectTrustModule> {
  const env = detectPiEnvironment();
  if (!env.pi.found || !env.pi.packageRoot) throw new PiNotReadyError('not-installed');
  if (cachedProjectTrust && cachedProjectTrustRoot === env.pi.packageRoot) return cachedProjectTrust;
  cachedProjectTrustRoot = env.pi.packageRoot;
  cachedProjectTrust = import(
    pathToFileURL(path.join(env.pi.packageRoot, 'dist/core/project-trust.js')).href
  ) as Promise<PiProjectTrustModule>;
  try {
    await cachedProjectTrust;
  } catch (err) {
    cachedProjectTrust = null;
    cachedProjectTrustRoot = null;
    throw err;
  }
  return cachedProjectTrust;
}
