// pi 安装检测：动态定位 Node/npm/pi，判定安装类型与版本。
// 路径一律动态解析（npm root -g / PATH 逐级 realpath），禁止硬编码。
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

function run(binPath: string, args: string[]): string | null {
  const useShell = needsWindowsCommandShell(binPath);
  try {
    return execFileSync(useShell ? path.basename(binPath) : binPath, args, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: envWithUserPath(),
      // Windows command shims require cmd.exe. Running from their own directory also
      // avoids shell parsing failures for standard paths such as C:\Program Files.
      shell: useShell,
      cwd: useShell ? path.dirname(binPath) : undefined,
    }).trim();
  } catch {
    return null;
  }
}

export function needsWindowsCommandShell(
  binPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && /\.(?:cmd|bat)$/i.test(binPath);
}

function findOnPath(bin: string, platform: NodeJS.Platform = process.platform): string | null {
  const exts = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  // 开发期壳自身 node_modules/.bin 里的 pi（devDependency 类型包）会遮蔽用户
  // 环境的 pi，必须跳过——检测的目标是用户环境安装，不是壳的开发依赖。
  const ownModules = path.resolve(process.cwd(), 'node_modules');
  for (const dir of resolveUserPath().split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      if (!existsSync(candidate)) continue;
      if (bin === 'pi') {
        try {
          if (realpathSync(candidate).startsWith(ownModules + path.sep)) continue;
        } catch {
          // realpath 失败不过滤
        }
      }
      return candidate;
    }
  }
  return null;
}

export function detectNode(): NodeDetectResult {
  const binPath = findOnPath('node');
  const out = binPath ? run(binPath, ['--version']) : null;
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
  const binPath = findOnPath('npm');
  const version = binPath ? run(binPath, ['--version']) : null;
  if (!binPath || !version) return { found: false };
  // 测试钩子：E2E 用临时 npm prefix 模拟各安装场景
  const rootOut = process.env.PI_DESKTOP_NPM_ROOT ?? run(binPath, ['root', '-g']);
  let globalRoot: string | undefined;
  if (rootOut && existsSync(rootOut)) {
    // macOS: /tmp → /private/tmp 等 symlink，比较前必须 realpath
    globalRoot = realpathSync(rootOut);
  }
  return { found: true, path: binPath, version, globalRoot };
}

function readCliVersion(binPath: string | undefined): string | undefined {
  const output = binPath ? run(binPath, ['--version']) : null;
  return output?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0];
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

function readPiPackageRoot(
  packageRoot: string,
  npm: NpmDetectResult,
): PiDetectResult | null {
  try {
    const realPackageRoot = realpathSync(packageRoot);
    const manifest = JSON.parse(readFileSync(path.join(realPackageRoot, 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
      bin?: string | Record<string, string>;
    };
    if (manifest.name !== PI_PACKAGE_NAME || typeof manifest.version !== 'string') return null;

    const cliRelative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pi;
    const realBinPath = cliRelative
      ? realpathSync(path.join(realPackageRoot, cliRelative))
      : undefined;
    const installKind: PiInstallKind =
      npm.globalRoot && isUnderDir(realPackageRoot, npm.globalRoot) ? 'npm' : 'non-npm';
    let meetsMin = false;
    try {
      meetsMin = gte(manifest.version, MIN_PI_VERSION);
    } catch {
      meetsMin = false;
    }

    return {
      found: true,
      binPath: realBinPath,
      realBinPath,
      packageRoot: realPackageRoot,
      version: manifest.version,
      cliVersion: readCliVersion(realBinPath),
      installKind,
      meetsMin,
    };
  } catch {
    return null;
  }
}

export function detectPiPackageRoot(
  packageRoot: string,
  npm: NpmDetectResult,
  devAllowsOutdated = false,
): PiDetectResult | null {
  const detected = readPiPackageRoot(packageRoot, npm);
  return detected ? { ...detected, devOverride: true, devAllowsOutdated } : null;
}

function detectDevPiOverride(npm: NpmDetectResult): PiDetectResult | null {
  // 只允许 Vite dev server 或 E2E 使用，打包应用即使被注入环境变量也不会放行。
  if (!process.env.VITE_DEV_SERVER_URL && process.env.PI_DESKTOP_E2E !== '1') return null;
  if (process.env.PI_DESKTOP_DEV_ALLOW_NON_NPM !== '1') return null;
  const packageRoot = process.env.PI_DESKTOP_DEV_PI_PACKAGE_ROOT;
  if (!packageRoot) return null;
  return detectPiPackageRoot(
    packageRoot,
    npm,
    process.env.PI_DESKTOP_DEV_ALLOW_OUTDATED === '1',
  );
}

function sameDirectory(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    const realLeft = realpathSync(left);
    const realRight = realpathSync(right);
    return platform === 'win32'
      ? realLeft.toLowerCase() === realRight.toLowerCase()
      : realLeft === realRight;
  } catch {
    return false;
  }
}

function detectWindowsNpmShim(
  binPath: string,
  npm: NpmDetectResult,
  platform: NodeJS.Platform,
): PiDetectResult | null {
  if (!needsWindowsCommandShell(binPath, platform)) return null;
  const shimDir = path.dirname(binPath);
  // 标准 npm 全局布局：shim 与全局 root 同属一个 prefix 目录
  if (
    npm.globalRoot
    && sameDirectory(shimDir, path.dirname(npm.globalRoot), platform)
  ) {
    const detected = readPiPackageRoot(path.join(npm.globalRoot, PI_PACKAGE_NAME), npm);
    if (detected) return { ...detected, binPath };
  }
  // npm --prefix <P> 的安装：包在 P/node_modules，shim 可能不属于当前全局 root；
  // 按 shim 自身 prefix 布局解析，是否算 npm 安装仍由 globalRoot 归属判定
  const detected = readPiPackageRoot(
    path.join(shimDir, 'node_modules', PI_PACKAGE_NAME),
    npm,
  );
  return detected ? { ...detected, binPath } : null;
}

export function detectPi(
  npm: NpmDetectResult,
  platform: NodeJS.Platform = process.platform,
): PiDetectResult {
  const binPath = findOnPath('pi', platform);
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
      base.cliVersion = readCliVersion(binPath);
      base.installKind = installKind;
      base.meetsMin = meetsMin;
    } else {
      // npm 在 Windows 上生成 pi.cmd/pi.bat，而不是指向包内 CLI 的 symlink。
      // 仅当 shim 与 npm 全局 root 属于同一 prefix 时，才从全局包目录解析。
      const npmShim = detectWindowsNpmShim(binPath, npm, platform);
      if (npmShim) return npmShim;
    }
  }

  // PATH 遮蔽场景：PATH 里的 pi 是 bun/install.sh 的，但 npm root 下也装着 npm 版
  if (npm.globalRoot && base.installKind !== 'npm') {
    const npmPackageRoot = path.join(npm.globalRoot, PI_PACKAGE_NAME);
    const npmPackage = readPiPackageRoot(npmPackageRoot, npm);
    if (npmPackage) {
      if (!base.found) {
        // Windows 不可直接 spawn 包内的 .js。标准 npm shim 已在上面映射；
        // shim 缺失或来自其他 prefix 时仍可直接加载 SDK，但不把它当 CLI 执行。
        return platform === 'win32' ? { ...npmPackage, binPath: undefined } : npmPackage;
      }
      base.npmInstalledVersion = npmPackage.version;
    }
  }

  return base;
}

export function detectPiEnvironment(): PiEnvironment {
  const node = detectNode();
  const npm = node.found ? detectNpm() : { found: false };
  const pi = npm.found
    ? detectDevPiOverride(npm) ?? detectPi(npm)
    : { found: false, meetsMin: false };
  return { node, npm, pi, minNodeVersion: MIN_NODE_VERSION, minPiVersion: MIN_PI_VERSION };
}
