import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FALLBACK_PI_VERSION, isPiVersionTested } from '@shared/pi-compat';
import type { PiCompatibilityReport } from '@shared/host-api/contract';
import { detectPiEnvironment } from '../../utils/pi-detector';

export class PiAdapterNotReadyError extends Error {
  constructor(public readonly reason: string) {
    super(`pi is not ready: ${reason}`);
    this.name = 'PiAdapterNotReadyError';
  }
}
import { buildCompatibilityReport } from './capabilities';
import { createGenericPiAdapter } from './generic-adapter';
import type { PiRuntimeAdapter, PiSdk } from './types';

let cached: Promise<PiRuntimeAdapter> | null = null;
let cachedRoot: string | null = null;

export async function loadPiAdapter(): Promise<PiRuntimeAdapter> {
  const environment = detectPiEnvironment();
  if (!environment.pi.found || !environment.pi.packageRoot) {
    throw new PiAdapterNotReadyError('not-installed');
  }
  if (environment.pi.installKind !== 'npm' && !environment.pi.devOverride) {
    throw new PiAdapterNotReadyError('non-npm-install');
  }
  if (!environment.pi.meetsMin && !(environment.pi.devOverride && environment.pi.devAllowsOutdated)) {
    throw new PiAdapterNotReadyError(`version-too-low:${environment.pi.version ?? 'unknown'}`);
  }
  const packageRoot = realpathSync(environment.pi.packageRoot);
  if (cached && cachedRoot === packageRoot) return cached;

  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as {
    exports?: Record<string, string | { import?: string; default?: string }>;
    main?: string;
  };
  const rootExport = manifest.exports?.['.'];
  const entryRel = (typeof rootExport === 'string' ? rootExport : rootExport?.import ?? rootExport?.default)
    ?? manifest.main;
  if (!entryRel) throw new PiAdapterNotReadyError('entry-not-found');
  const entry = realpathSync(path.join(packageRoot, entryRel));
  cachedRoot = packageRoot;
  cached = import(pathToFileURL(entry).href)
    .then((sdk) => {
      const report = buildCompatibilityReport({
        sdk: sdk as PiSdk,
        version: environment.pi.version ?? 'unknown',
        packageRoot,
        cliPath: environment.pi.realBinPath ?? environment.pi.binPath,
        cliVersion: environment.pi.cliVersion ?? environment.pi.version,
        nodePath: environment.node.path,
        nodeVersion: environment.node.version,
        npmPath: environment.npm.path,
        npmVersion: environment.npm.version,
        npmRoot: environment.npm.globalRoot,
        testedRange: isPiVersionTested(environment.pi.version ?? ''),
        meetsMinimum: environment.pi.meetsMin,
        warnings: environment.pi.npmInstalledVersion
          ? [`PATH pi differs from the npm SDK package (npm package version ${environment.pi.npmInstalledVersion}).`]
          : [],
      });
      return createGenericPiAdapter({
        sdk: sdk as PiSdk,
        packageRoot,
        packageVersion: environment.pi.version ?? 'unknown',
        cliPath: environment.pi.realBinPath ?? environment.pi.binPath,
        cliVersion: environment.pi.cliVersion ?? environment.pi.version,
        compatibility: report,
      });
    }) as Promise<PiRuntimeAdapter>;
  try {
    await cached;
  } catch (error) {
    cached = null;
    cachedRoot = null;
    throw error;
  }
  return cached;
}

export function compatibilityFailure(report: PiCompatibilityReport): string {
  const missing = report.missingRequiredCapabilities.length > 0
    ? `missing capabilities: ${report.missingRequiredCapabilities.join(', ')}`
    : report.warnings.join(' ');
  return `incompatible:${missing || `install ${FALLBACK_PI_VERSION}`}`;
}

export function invalidatePiAdapterCache(): void {
  cached = null;
  cachedRoot = null;
}

export async function inspectPiCompatibility(): Promise<PiCompatibilityReport | undefined> {
  try {
    return (await loadPiAdapter()).compatibility;
  } catch (error) {
    const environment = detectPiEnvironment();
    if (!environment.pi.found || !environment.pi.packageRoot || !environment.pi.version) return undefined;
    return {
      status: 'incompatible',
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
      testedRange: isPiVersionTested(environment.pi.version),
      recommendedVersion: FALLBACK_PI_VERSION,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}
