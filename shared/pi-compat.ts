// pi 兼容性元数据的唯一运行时来源。package.json#piCompat 供发布和 CI 展示，
// 由单元测试校验其 min/tested 与这里保持一致。
export const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
export const MIN_PI_VERSION = '0.83.0';
/** Stable version used only for fallback/recovery and the checked-in SDK contract tests. */
export const FALLBACK_PI_VERSION = '0.84.2';
/** Kept as an alias for callers that still use the old name. */
export const RECOMMENDED_PI_VERSION = FALLBACK_PI_VERSION;
export const TESTED_PI_RANGES = ['0.83.x', '0.84.x'] as const;

export function isPiVersionTested(version: string): boolean {
  const [major, minor] = version.split('.');
  return TESTED_PI_RANGES.some((range) => range === `${major}.${minor}.x`);
}

// pi 的 engines 要求（Node >= 22.19.0）
export const MIN_NODE_VERSION = '22.19.0';
export const PI_NPM_REGISTRY_URL =
  'https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest';

export function getPiRegistryUrl(): string {
  return process.env.PI_DESKTOP_PI_REGISTRY_URL ?? PI_NPM_REGISTRY_URL;
}
