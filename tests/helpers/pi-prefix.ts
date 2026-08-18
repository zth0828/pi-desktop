// 测试用的 pi 安装前缀：每个矩阵版本使用独立 npm 全局布局。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PI_PACKAGE = '@earendil-works/pi-coding-agent';
const REQUESTED_VERSION = process.env.PI_TEST_VERSION ?? '0.84.2';
const TESTED_VERSION = REQUESTED_VERSION === 'latest'
  ? execFileSync('npm', ['view', PI_PACKAGE, 'version'], { encoding: 'utf8', timeout: 30_000 }).trim()
  : REQUESTED_VERSION;
const PREFIX = resolve(`.cache/pi-test-prefix-${REQUESTED_VERSION.replace(/[^0-9A-Za-z.-]/g, '-')}-${TESTED_VERSION.replace(/[^0-9A-Za-z.-]/g, '-')}`);
const NPM_ROOT = process.platform === 'win32'
  ? join(PREFIX, 'node_modules')
  : join(PREFIX, 'lib/node_modules');
const NPM_BIN_DIR = process.platform === 'win32' ? PREFIX : join(PREFIX, 'bin');
const PKG_DIR = join(NPM_ROOT, '@earendil-works/pi-coding-agent');

function installedVersion(): string | null {
  const manifest = join(PKG_DIR, 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

export function ensurePiTestPrefix(): string {
  if (installedVersion() !== TESTED_VERSION) {
    execFileSync('npm', ['i', '-g', '--prefix', PREFIX, `${PI_PACKAGE}@${TESTED_VERSION}`], {
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
