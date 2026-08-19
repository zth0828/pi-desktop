import type {
  PiCapabilities,
  PiCapabilityReport,
  PiCompatibilityReport,
} from '@shared/host-api/contract';
import { FALLBACK_PI_VERSION } from '@shared/pi-compat';

const REQUIRED_EXPORTS = [
  'createAgentSessionServices',
  'createAgentSessionFromServices',
  'createAgentSessionRuntime',
  'SessionManager',
  'SettingsManager',
  'createEventBus',
] as const;
const OPTIONAL_EXPORTS = ['ModelRuntime', 'DefaultPackageManager', 'ProjectTrustStore', 'getAgentDir'] as const;
const MODULE_KEYS: Record<(typeof REQUIRED_EXPORTS)[number], keyof PiCapabilities | string> = {
  createAgentSessionServices: 'createAgentSessionServices',
  createAgentSessionFromServices: 'createAgentSessionFromServices',
  createAgentSessionRuntime: 'createAgentSessionRuntime',
  SessionManager: 'sessionManager',
  SettingsManager: 'settingsManager',
  createEventBus: 'eventBus',
};

function hasExport(sdk: Record<string, unknown>, name: string): boolean {
  const value = sdk[name];
  return typeof value === 'function' || (value !== null && typeof value === 'object');
}

export function detectPiCapabilities(sdk: Record<string, unknown>): PiCapabilities {
  return {
    createAgentSessionServices: hasExport(sdk, 'createAgentSessionServices'),
    createAgentSessionFromServices: hasExport(sdk, 'createAgentSessionFromServices'),
    createAgentSessionRuntime: hasExport(sdk, 'createAgentSessionRuntime'),
    sessionManager: hasExport(sdk, 'SessionManager'),
    settingsManager: hasExport(sdk, 'SettingsManager'),
    eventBus: hasExport(sdk, 'createEventBus'),
    prompt: false,
    subscribe: false,
    abort: false,
  };
}

export function buildCapabilityReport(sdk: Record<string, unknown>): PiCapabilityReport {
  return {
    module: {
      ...Object.fromEntries(REQUIRED_EXPORTS.map((name) => [name, hasExport(sdk, name) ? 'available' : 'missing'])),
      ...Object.fromEntries(OPTIONAL_EXPORTS.map((name) => [name, hasExport(sdk, name) ? 'available' : 'missing'])),
    },
    session: { prompt: 'not-checked', subscribe: 'not-checked', abort: 'not-checked' },
    optional: {
      resolveProjectTrusted: 'not-checked',
      toolsManager: 'not-checked',
      resources: 'not-checked',
    },
  };
}

export function missingRequiredCapabilities(capabilities: PiCapabilities): string[] {
  const required: Array<[keyof PiCapabilities, string]> = [
    ['createAgentSessionServices', 'createAgentSessionServices'],
    ['createAgentSessionFromServices', 'createAgentSessionFromServices'],
    ['createAgentSessionRuntime', 'createAgentSessionRuntime'],
    ['sessionManager', 'SessionManager'],
    ['settingsManager', 'SettingsManager'],
    ['eventBus', 'createEventBus'],
  ];
  return required.filter(([key]) => !capabilities[key]).map(([, name]) => name);
}

export function validateSessionCapabilities(
  report: PiCompatibilityReport,
  session: Record<string, unknown>,
): string[] {
  const names = ['prompt', 'subscribe', 'abort'] as const;
  const missing = names.filter((name) => typeof session[name] !== 'function');
  const capabilityReport = report.capabilityReport ?? {
    module: {},
    session: { prompt: 'not-checked', subscribe: 'not-checked', abort: 'not-checked' },
    optional: {},
  };
  report.capabilityReport = capabilityReport;
  for (const name of names) {
    const available = !missing.includes(name);
    report.capabilities[name] = available;
    capabilityReport.session[name] = available ? 'available' : 'missing';
  }
  if (missing.length > 0) {
    report.status = 'incompatible';
    report.failureCode = 'missing-session-capability';
    for (const name of missing) {
      if (!report.missingRequiredCapabilities.includes(name)) report.missingRequiredCapabilities.push(name);
    }
  }
  return missing;
}

export function buildCompatibilityReport(input: {
  sdk: Record<string, unknown>;
  version: string;
  packageRoot: string;
  generation?: string;
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
  const sdkRecord = input.sdk as unknown as Record<string, unknown>;
  const capabilities = detectPiCapabilities(sdkRecord);
  const capabilityReport = buildCapabilityReport(sdkRecord);
  const missing = missingRequiredCapabilities(capabilities);
  for (const name of REQUIRED_EXPORTS) {
    const key = MODULE_KEYS[name];
    if (capabilityReport.module[name] === 'missing' && !missing.includes(String(key))) missing.push(name);
  }  const warnings = [...(input.warnings ?? [])];
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
    capabilityReport,
    failureCode: !input.meetsMinimum ? 'version-too-low' : missing.length > 0 ? 'missing-public-export' : undefined,
    testedRange: input.testedRange,
    recommendedVersion: FALLBACK_PI_VERSION,
    warnings,
    generation: input.generation,
  };
}
