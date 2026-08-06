// pi 安装检测：动态定位 Node/npm/pi，判定安装类型与版本。
// 路径一律动态解析（npm root -g / PATH 逐级 realpath），禁止硬编码（AGENTS.md）。
// 核心机制经 Spike A 验证（docs/TECHNICAL-PLAN.md §2）。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { MIN_NODE_VERSION, MIN_PI_VERSION, PI_PACKAGE_NAME } from '@shared/pi-compat';
import type {
  NodeDetectResult,
  NpmDetectResult,
  PiDetectResult,
  PiEnvironment,
  PiInstallKind,
} from '@shared/host-api/contract';
import { gte } from './semver';
import { envWithUserPath, resolveUserPath } from './shell-env';

export type { NodeDetectResult, NpmDetectResult, PiDetectResult, PiEnvironment, PiInstallKind };

function run(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: envWithUserPath(),
    }).trim();
  } catch {
    return null;
  }
}

function findOnPath(bin: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of resolveUserPath().split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function detectNode(): NodeDetectResult {
  const binPath = findOnPath('node');
  const out = binPath ? run('node', ['--version']) : null;
  if (!binPath || !out) return { found: false, meetsMin: false };
  const version = out.replace(/^v/, '');
  let meetsMin = false;
  try {
    meetsMin = gte(version, MIN_NODE_VERSION);
  } catch {
    meetsMin = false;
  }
  return { found: true, path: binPath, version, meetsMin };
}

export function detectNpm(): NpmDetectResult {
  const version = findOnPath('npm') ? run('npm', ['--version']) : null;
  if (!version) return { found: false };
  // 测试钩子：E2E 用临时 npm prefix 模拟各安装场景
  const rootOut = process.env.PI_DESKTOP_NPM_ROOT ?? run('npm', ['root', '-g']);
  let globalRoot: string | undefined;
  if (rootOut && existsSync(rootOut)) {
    // macOS: /tmp → /private/tmp 等 symlink，比较前必须 realpath（Spike A 教训）
    globalRoot = realpathSync(rootOut);
  }
  return { found: true, version, globalRoot };
}

/** 从 bin 真实路径向上找 pi 包的 package.json。 */
export function locatePackageRoot(realBinPath: string): { packageRoot: string; version: string } | null {
  let dir = path.dirname(realBinPath);
  while (dir !== path.dirname(dir)) {
    const manifestPath = path.join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.name === PI_PACKAGE_NAME && typeof manifest.version === 'string') {
          return { packageRoot: dir, version: manifest.version };
        }
      } catch {
        // 继续向上
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

export function isUnderDir(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function detectPi(npm: NpmDetectResult): PiDetectResult {
  const binPath = findOnPath('pi');
  const base: PiDetectResult = { found: false, meetsMin: false };

  if (binPath) {
    let located: { packageRoot: string; version: string } | null = null;
    let realBinPath: string | undefined;
    try {
      realBinPath = realpathSync(binPath);
      located = locatePackageRoot(realBinPath);
    } catch {
      located = null;
    }
    if (located) {
      const installKind: PiInstallKind =
        npm.globalRoot && isUnderDir(located.packageRoot, npm.globalRoot) ? 'npm' : 'non-npm';
      let meetsMin = false;
      try {
        meetsMin = gte(located.version, MIN_PI_VERSION);
      } catch {
        meetsMin = false;
      }
      base.found = true;
      base.binPath = binPath;
      base.realBinPath = realBinPath;
      base.packageRoot = located.packageRoot;
      base.version = located.version;
      base.installKind = installKind;
      base.meetsMin = meetsMin;
    }
  }

  // PATH 遮蔽场景：PATH 里的 pi 是 bun/install.sh 的，但 npm root 下也装着 npm 版
  if (npm.globalRoot && base.installKind !== 'npm') {
    const npmManifest = path.join(npm.globalRoot, PI_PACKAGE_NAME, 'package.json');
    if (existsSync(npmManifest)) {
      try {
        const manifest = JSON.parse(readFileSync(npmManifest, 'utf8'));
        if (typeof manifest.version === 'string') base.npmInstalledVersion = manifest.version;
      } catch {
        // 忽略
      }
    }
  }

  return base;
}

export function detectPiEnvironment(): PiEnvironment {
  const node = detectNode();
  const npm = node.found ? detectNpm() : { found: false };
  const pi = npm.found ? detectPi(npm) : { found: false, meetsMin: false };
  return { node, npm, pi, minNodeVersion: MIN_NODE_VERSION, minPiVersion: MIN_PI_VERSION };
}
