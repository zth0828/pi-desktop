// 测试用的 pi 安装前缀：把 pi 以 npm 全局布局装进 node_modules/.cache/pi-test-prefix。
// E2E 与契约测试共用；幂等，已存在且版本达标则直接复用。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 放在 repo 的 .cache/（已 gitignore）。不能放 node_modules 里：
// pi-detector 会跳过壳自身 node_modules 下的 pi（防止 devDependency 遮蔽）。
const PREFIX = resolve('.cache/pi-test-prefix');
const NPM_ROOT = process.platform === 'win32'
  ? join(PREFIX, 'node_modules')
  : join(PREFIX, 'lib/node_modules');
const NPM_BIN_DIR = process.platform === 'win32' ? PREFIX : join(PREFIX, 'bin');
const PKG_DIR = join(NPM_ROOT, '@earendil-works/pi-coding-agent');
const PI_PACKAGE = '@earendil-works/pi-coding-agent';
const MIN_VERSION = '0.83.0';

function installedVersion(): string | null {
  const manifest = join(PKG_DIR, 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function gteMinor(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

export function ensurePiTestPrefix(): string {
  const version = installedVersion();
  if (!version || !gteMinor(version, MIN_VERSION)) {
    execFileSync('npm', ['i', '-g', '--prefix', PREFIX, `${PI_PACKAGE}@^${MIN_VERSION}`], {
      shell: process.platform === 'win32',
      stdio: 'inherit',
      timeout: 300_000,
    });
  }
  return PREFIX;
}

export function piTestEnv(): {
  piPrefix: string;
  piBinDir: string;
  npmRoot: string;
  piPackageRoot: string;
} {
  const piPrefix = ensurePiTestPrefix();
  return {
    piPrefix,
    piBinDir: NPM_BIN_DIR,
    npmRoot: NPM_ROOT,
    piPackageRoot: PKG_DIR,
  };
}
