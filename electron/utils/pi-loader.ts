// pi SDK 加载器：从用户环境的 npm 全局安装动态 import。
// 只支持 npm 安装；检测不到/版本不够/非 npm 安装都在这里变成「未就绪」。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectPiEnvironment } from './pi-detector';

// 类型仅来自 devDependency（编译期）；运行时是用户环境里的那份 pi。
export type PiSdk = typeof import('@earendil-works/pi-coding-agent');

export class PiNotReadyError extends Error {
  constructor(public readonly reason: string) {
    super(`pi is not ready: ${reason}`);
    this.name = 'PiNotReadyError';
  }
}

let cached: Promise<PiSdk> | null = null;
let cachedPackageRoot: string | null = null;

export async function loadPiSdk(): Promise<PiSdk> {
  const env = detectPiEnvironment();
  if (!env.pi.found || !env.pi.packageRoot) {
    throw new PiNotReadyError('not-installed');
  }
  if (env.pi.installKind !== 'npm' && !env.pi.devOverride) {
    throw new PiNotReadyError('non-npm-install');
  }
  if (!env.pi.meetsMin && !(env.pi.devOverride && env.pi.devAllowsOutdated)) {
    throw new PiNotReadyError(`version-too-low:${env.pi.version ?? 'unknown'}`);
  }
  if (cached && cachedPackageRoot === env.pi.packageRoot) return cached;

  const manifest = JSON.parse(
    readFileSync(path.join(env.pi.packageRoot, 'package.json'), 'utf8'),
  ) as { exports?: Record<string, { import?: string }>; main?: string };
  const entryRel = manifest.exports?.['.']?.import ?? manifest.main;
  if (!entryRel) throw new PiNotReadyError('entry-not-found');
  const entry = path.join(env.pi.packageRoot, entryRel);

  // createRequire 只用于定位；ESM 包一律走 dynamic import(fileURL)
  cachedPackageRoot = env.pi.packageRoot;
  cached = import(pathToFileURL(entry).href) as Promise<PiSdk>;
  try {
    await cached;
  } catch (err) {
    cached = null;
    cachedPackageRoot = null;
    throw err;
  }
  return cached;
}

/** pi 被安装/升级后调用：下次 loadPiSdk 重新解析。 */
export function invalidatePiSdkCache(): void {
  cached = null;
  cachedPackageRoot = null;
}
