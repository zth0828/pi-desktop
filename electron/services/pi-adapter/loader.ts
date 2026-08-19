import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FALLBACK_PI_VERSION, isPiVersionTested } from '@shared/pi-compat';
import type {
  PiCompatibilityFailureCode,
  PiCompatibilityReport,
} from '@shared/host-api/contract';
import { detectPiEnvironment } from '../../utils/pi-detector';
import { buildCompatibilityReport } from './capabilities';
import { createGenericPiAdapter } from './generic-adapter';
import type { PiRuntimeAdapter } from './types';
import type { PiSdk } from './internal-types';

export class PiAdapterNotReadyError extends Error {
  constructor(
    public readonly reason: PiCompatibilityFailureCode | string,
    public readonly detail?: string,
  ) {
    super(`pi is not ready: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'PiAdapterNotReadyError';
  }
}

type Installation = {
  packageRoot: string;
  packageVersion: string;
  entry: string;
  generation: string;
  manifestFingerprint: string;
  manifest: { version?: string; exports?: Record<string, string | { import?: string; default?: string }>; main?: string };
};

let cached: Promise<PiRuntimeAdapter> | null = null;
let loadedGeneration: string | null = null;
let loadedAdapter: PiRuntimeAdapter | null = null;

function readInstallation(packageRootValue: string): Installation {
  const packageRoot = realpathSync(packageRootValue);
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as Installation['manifest'];
  const rootExport = manifest.exports?.['.'];
  const entryRel = (typeof rootExport === 'string' ? rootExport : rootExport?.import ?? rootExport?.default)
    ?? manifest.main;
  if (!entryRel) throw new PiAdapterNotReadyError('entry-not-found');
  let entry: string;
  try {
    entry = realpathSync(path.join(packageRoot, entryRel));
  } catch (error) {
    throw new PiAdapterNotReadyError('entry-not-found', error instanceof Error ? error.message : String(error));
  }
  const manifestStat = statSync(manifestPath);
  const entryStat = statSync(entry);
  const manifestFingerprint = createHash('sha256')
    .update(manifestText)
    .update(String(manifestStat.size))
    .update(String(manifestStat.mtimeMs))
    .update(String(entryStat.size))
    .update(String(entryStat.mtimeMs))
    .digest('hex');
  const packageVersion = manifest.version ?? 'unknown';
  const generation = createHash('sha256')
    .update(packageRoot)
    .update(packageVersion)
    .update(entry)
    .update(manifestFingerprint)
    .digest('hex');
  return { packageRoot, packageVersion, entry, generation, manifestFingerprint, manifest };
}

/**
 * 全局代理引导：把壳设置解析出的代理（auto 跟随系统代理/manual/off）应用到
 * undici 全局 dispatcher。壳不跑 pi 的 main.js（只有那里才会调用
 * applyHttpProxySettings + configureHttpDispatcher），这里在 SDK 加载后补上，
 * 否则 ModelRuntime 的请求不走用户配置的代理，海外供应商直连会失败。
 */
async function applyPiHttpProxy(packageRoot: string): Promise<void> {
  try {
    const { resolveProxy } = await import('../proxy-api');
    const resolved = await resolveProxy();
    const mod = await import(pathToFileURL(path.join(packageRoot, 'dist/core/http-dispatcher.js')).href) as {
      applyHttpProxySettings?: (proxy?: string) => void;
      configureHttpDispatcher?: (timeoutMs?: number) => void;
    };
    mod.applyHttpProxySettings?.(resolved.url);
    mod.configureHttpDispatcher?.();
  } catch (error) {
    // 代理引导是尽力而为：失败时请求仍然可用；错误仅用于诊断排查。
    console.error('[applyPiHttpProxy]', error instanceof Error ? error.message : String(error));
  }
}

export async function loadPiAdapter(): Promise<PiRuntimeAdapter> {
  const environment = detectPiEnvironment();
  if (!environment.pi.found || !environment.pi.packageRoot) {
    throw new PiAdapterNotReadyError('not-installed');
  }
  if (environment.pi.installKind !== 'npm' && !environment.pi.devOverride) {
    throw new PiAdapterNotReadyError('non-npm-install');
  }
  if (!environment.pi.meetsMin && !(environment.pi.devOverride && environment.pi.devAllowsOutdated)) {
    throw new PiAdapterNotReadyError('version-too-low', environment.pi.version ?? 'unknown');
  }

  const installation = readInstallation(environment.pi.packageRoot);
  if (loadedGeneration && loadedGeneration !== installation.generation) {
    throw new PiAdapterNotReadyError('restart-required',
      `loaded ${loadedAdapter?.packageVersion ?? 'unknown'}, disk ${installation.packageVersion}`);
  }
  if (loadedAdapter && loadedGeneration === installation.generation) return loadedAdapter;
  if (cached) return cached;

  cached = import(pathToFileURL(installation.entry).href)
    .then(async (module) => {
      const sdk = module as PiSdk;
      await applyPiHttpProxy(installation.packageRoot);
      const report = buildCompatibilityReport({
        sdk,
        version: installation.packageVersion,
        packageRoot: installation.packageRoot,
        generation: installation.generation,
        cliPath: environment.pi.realBinPath ?? environment.pi.binPath,
        cliVersion: environment.pi.cliVersion ?? environment.pi.version,
        nodePath: environment.node.path,
        nodeVersion: environment.node.version,
        npmPath: environment.npm.path,
        npmVersion: environment.npm.version,
        npmRoot: environment.npm.globalRoot,
        testedRange: isPiVersionTested(installation.packageVersion),
        meetsMinimum: environment.pi.meetsMin,
        warnings: environment.pi.npmInstalledVersion
          ? [`PATH pi differs from the npm SDK package (npm package version ${environment.pi.npmInstalledVersion}).`]
          : [],
      });
      const adapter = createGenericPiAdapter({
        sdk,
        packageRoot: installation.packageRoot,
        packageVersion: installation.packageVersion,
        generation: installation.generation,
        cliPath: environment.pi.realBinPath ?? environment.pi.binPath,
        cliVersion: environment.pi.cliVersion ?? environment.pi.version,
        nodePath: environment.node.path,
        nodeVersion: environment.node.version,
        npmPath: environment.npm.path,
        npmVersion: environment.npm.version,
        npmRoot: environment.npm.globalRoot,
        compatibility: report,
      });
      loadedGeneration = installation.generation;
      loadedAdapter = adapter;
      return adapter;
    })
    .catch((error) => {
      cached = null;
      if (error instanceof PiAdapterNotReadyError) throw error;
      throw new PiAdapterNotReadyError('module-import-failed', error instanceof Error ? error.message : String(error));
    });
  return cached;
}

export function compatibilityFailure(report: PiCompatibilityReport): string {
  if (report.failureCode) return `${report.failureCode}:${report.failureDetail ?? report.warnings.join(' ')}`;
  const missing = report.missingRequiredCapabilities.length > 0
    ? `missing capabilities: ${report.missingRequiredCapabilities.join(', ')}`
    : report.warnings.join(' ');
  return `incompatible:${missing || `install ${FALLBACK_PI_VERSION}`}`;
}

/** Clears adapter-owned service caches. The already imported ESM generation remains pinned;
 * a changed on-disk generation is reported as restart-required. */
export function invalidatePiAdapterCache(): void {
  cached = null;
}

export async function inspectPiCompatibility(): Promise<PiCompatibilityReport | undefined> {
  try {
    return (await loadPiAdapter()).compatibility;
  } catch (error) {
    const environment = detectPiEnvironment();
    if (!environment.pi.found || !environment.pi.packageRoot || !environment.pi.version) return undefined;
    const failureCode = error instanceof PiAdapterNotReadyError
      ? error.reason as PiCompatibilityFailureCode
      : 'module-import-failed';
    return {
      status: failureCode === 'restart-required' ? 'restart-required' : 'incompatible',
      version: environment.pi.version,
      packageRoot: environment.pi.packageRoot,
      cliPath: environment.pi.realBinPath ?? environment.pi.binPath,
      cliVersion: environment.pi.cliVersion ?? environment.pi.version,
      nodePath: environment.node.path,
      nodeVersion: environment.node.version,
      npmPath: environment.npm.path,
      npmVersion: environment.npm.version,
      npmRoot: environment.npm.globalRoot,
      missingRequiredCapabilities: [],
      optionalCapabilities: {},
      capabilities: {
        createAgentSessionServices: false,
        createAgentSessionFromServices: false,
        createAgentSessionRuntime: false,
        sessionManager: false,
        settingsManager: false,
        eventBus: false,
        prompt: false,
        subscribe: false,
        abort: false,
      },
      capabilityReport: {
        module: {},
        session: { prompt: 'not-checked', subscribe: 'not-checked', abort: 'not-checked' },
        optional: {},
      },
      failureCode,
      failureDetail: error instanceof Error ? error.message : String(error),
      testedRange: isPiVersionTested(environment.pi.version),
      recommendedVersion: FALLBACK_PI_VERSION,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}
