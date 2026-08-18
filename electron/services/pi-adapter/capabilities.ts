import type { PiCapabilities, PiCompatibilityReport } from '@shared/host-api/contract';
import { FALLBACK_PI_VERSION } from '@shared/pi-compat';
import type { PiSdk } from './types';

const REQUIRED_EXPORTS = [
  'createAgentSessionServices',
  'createAgentSessionFromServices',
  'createAgentSessionRuntime',
  'SessionManager',
  'SettingsManager',
  'createEventBus',
] as const;

export function detectPiCapabilities(sdk: Record<string, unknown>): PiCapabilities {
  const has = (name: string): boolean => {
    const value = sdk[name];
    return typeof value === 'function' || (value !== null && typeof value === 'object');
  };
  return {
    createAgentSessionServices: has('createAgentSessionServices'),
    createAgentSessionFromServices: has('createAgentSessionFromServices'),
    createAgentSessionRuntime: has('createAgentSessionRuntime'),
    sessionManager: has('SessionManager'),
    settingsManager: has('SettingsManager'),
    eventBus: has('createEventBus'),
    // These are checked again against the created AgentSession. The adapter
    // exposes only these operations, so a generic adapter can validate them
    // without probing prompt() and causing a provider request.
    prompt: true,
    subscribe: true,
    abort: true,
  };
}

export function missingRequiredCapabilities(capabilities: PiCapabilities): string[] {
  return REQUIRED_EXPORTS.filter((name) => {
    const key = name === 'createAgentSessionServices'
      ? 'createAgentSessionServices'
      : name === 'createAgentSessionFromServices'
        ? 'createAgentSessionFromServices'
        : name === 'createAgentSessionRuntime'
          ? 'createAgentSessionRuntime'
          : name === 'SessionManager'
            ? 'sessionManager'
            : name === 'SettingsManager'
              ? 'settingsManager'
              : 'eventBus';
    return !capabilities[key];
  });
}

export function buildCompatibilityReport(input: {
  sdk: PiSdk;
  version: string;
  packageRoot: string;
  cliPath?: string;
  cliVersion?: string;
  nodePath?: string;
  nodeVersion?: string;
  npmPath?: string;
  npmVersion?: string;
  npmRoot?: string;
  testedRange: boolean;
  meetsMinimum: boolean;
  warnings?: string[];
}): PiCompatibilityReport {
  const capabilities = detectPiCapabilities(input.sdk as unknown as Record<string, unknown>);
  const missing = missingRequiredCapabilities(capabilities);
  const warnings = [...(input.warnings ?? [])];
  if (!input.testedRange && missing.length === 0 && input.meetsMinimum) {
    warnings.push('This pi version has the required public SDK capabilities but is outside the tested range.');
  }
  if (!input.meetsMinimum) warnings.push('The installed pi version is below the minimum supported version.');
  const status = !input.meetsMinimum || missing.length > 0
    ? 'incompatible'
    : input.testedRange ? 'tested' : 'compatible-untested';
  return {
    status,
    version: input.version,
    packageRoot: input.packageRoot,
    cliPath: input.cliPath,
    cliVersion: input.cliVersion,
    nodePath: input.nodePath,
    nodeVersion: input.nodeVersion,
    npmPath: input.npmPath,
    npmVersion: input.npmVersion,
    npmRoot: input.npmRoot,
    missingRequiredCapabilities: missing,
    optionalCapabilities: {},
    capabilities,
    testedRange: input.testedRange,
    recommendedVersion: FALLBACK_PI_VERSION,
    warnings,
  };
}
