// 测试用的 pi 安装前缀：每个矩阵版本使用独立 npm 全局布局。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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

/** 并发安装互斥：并行 E2E worker 首次运行时都会走到安装分支，npm i -g --prefix
 *  同一目录会竞争损坏；用原子 mkdir 锁 + 轮询，持锁者安装，其余等待。 */
function acquireInstallLock(lockDir: string): () => void {
  const deadline = Date.now() + 300_000;
  for (;;) {
    try {
      mkdirSync(lockDir);
      return () => {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // 锁清理失败不阻塞
        }
      };
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for pi prefix install lock: ${lockDir}`);
      }
      // 锁持有者崩溃（worker 被杀）时锁目录残留：mtime 超过 2 分钟视为过期强占
      try {
        const st = statSync(lockDir);
        if (Date.now() - st.mtimeMs > 120_000) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

export function ensurePiTestPrefix(): string {
  if (installedVersion() === TESTED_VERSION) return PREFIX;
  const release = acquireInstallLock(`${PREFIX}.install-lock`);
  try {
    // 等待者拿到锁后可能已被持锁者装好，先重查再安装
    if (installedVersion() === TESTED_VERSION) return PREFIX;
    execFileSync('npm', ['i', '-g', '--prefix', PREFIX, `${PI_PACKAGE}@${TESTED_VERSION}`], {
      shell: process.platform === 'win32',
      stdio: 'inherit',
      timeout: 300_000,
    });
  } finally {
    release();
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
