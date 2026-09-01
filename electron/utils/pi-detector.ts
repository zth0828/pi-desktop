// pi 安装检测：动态定位 Node/npm/pi，判定安装类型与版本。
// 路径一律动态解析（npm root -g / PATH 逐级 realpath），禁止硬编码。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';import path from 'node:path';
import { promisify } from 'node:util';
import { MIN_NODE_VERSION, MIN_PI_VERSION, PI_PACKAGE_NAME } from '@shared/pi-compat';
import type {
  NodeDetectResult,
  NpmDetectResult,
  PiDetectResult,
  PiEnvironment,
  PiInstallKind,
} from '@shared/host-api/contract';
import { gte } from './semver';
import { safeErrorFields, writePiDiagnostic } from './pi-diagnostic-log';
import { envWithUserPath, resolveUserPath } from './shell-env';

export type { NodeDetectResult, NpmDetectResult, PiDetectResult, PiEnvironment, PiInstallKind };

// execFile 必须异步执行：同步版会阻塞主进程（node/npm/pi 链式最多约 24s），
// 期间所有 IPC 与窗口事件冻结。promisify 的重载推断不保留 encoding 约束，
// 这里显式收窄为 string 输出；stdio 在 ExecFileOptions 类型上缺失但 spawn
// 层支持（stdin ignore），保留原同步版的选项行为。
const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options: Parameters<typeof execFile>[2] & { stdio?: ('ignore' | 'pipe')[] },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

async function run(binPath: string, args: string[]): Promise<string | null> {
  const useShell = needsWindowsCommandShell(binPath);
  try {
    const { stdout } = await execFileAsync(useShell ? path.basename(binPath) : binPath, args, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: envWithUserPath(),
      // Windows command shims require cmd.exe. Running from their own directory also
      // avoids shell parsing failures for standard paths such as C:\Program Files.
      shell: useShell,
      cwd: useShell ? path.dirname(binPath) : undefined,
    });
    return (typeof stdout === 'string' ? stdout : stdout.toString('utf8')).trim();
  } catch (err) {
    // 失败原因（超时/ENOENT/非零退出）不吞掉：写入诊断日志供排障，检测仍按未找到处理。
    writePiDiagnostic({
      level: 'warning',
      event: 'pi-detect.exec-failed',
      detail: `${useShell ? path.basename(binPath) : binPath} ${args.join(' ')}`,
      ...safeErrorFields(err),
    });
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

// 测试钩子（E2E 用临时 npm prefix 模拟各安装场景）只对开发/未打包运行生效：
// 真实用户机器上恰好存在同名环境变量时，不得污染安装类型判定——生产一律
// 真实执行 npm root -g。process.defaultApp 在 `electron <entry>` 直启
// （dev / E2E / 验证脚本）时为 true，打包产物为 undefined。
function devNpmRootOverride(): string | undefined {
  const isDev = process.env.NODE_ENV === 'development'
    || !!process.env.VITE_DEV_SERVER_URL
    || process.env.PI_DESKTOP_E2E === '1'
    || process.defaultApp === true;
  if (!isDev) return undefined;
  const value = process.env.PI_DESKTOP_NPM_ROOT;
  return value && value.length > 0 ? value : undefined;
}

export async function detectNode(): Promise<NodeDetectResult> {
  const binPath = findOnPath('node');
  const out = binPath ? await run(binPath, ['--version']) : null;
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

export async function detectNpm(): Promise<NpmDetectResult> {
  const binPath = findOnPath('npm');
  const version = binPath ? await run(binPath, ['--version']) : null;
  if (!binPath || !version) return { found: false };
  const rootOut = devNpmRootOverride() ?? await run(binPath, ['root', '-g']);
  let globalRoot: string | undefined;
  if (rootOut && existsSync(rootOut)) {
    // macOS: /tmp → /private/tmp 等 symlink，比较前必须 realpath
    globalRoot = realpathSync(rootOut);
  }
  return { found: true, path: binPath, version, globalRoot };
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
  // Windows 路径大小写不敏感；realpath 可能返回不同的 case（如用户目录），
  // 比较前统一小写，避免 npm 归属误判为 non-npm。
  if (process.platform === 'win32') {
    child = child.toLowerCase();
    parent = parent.toLowerCase();
  }
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
      // bin 由 manifest.bin 推导，必然位于包内：CLI 版本即包版本。不 spawn
      // `pi --version` 核对——Windows cmd shim 冷启动约 2s，且直跑 .js 会失败
      // 返回 null（之前 Windows 上这里本来就是 null，靠 ?? version 兜底）。
      cliVersion: manifest.version,
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

export async function detectPi(
  npm: NpmDetectResult,
  platform: NodeJS.Platform = process.platform,
): Promise<PiDetectResult> {
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
      // located 即 bin 真实路径向上定位到的 pi 包：CLI 版本与包版本一致，
      // 无需再 spawn `pi --version`（2s 级 cmd shim 冷启动）。
      base.cliVersion = located.version;
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

// 检测结果缓存：detectPiEnvironment 每次会 spawn node/npm/pi 子进程
// （Windows 上 npm/pi 走 cmd shim，pi --version 冷启动可达 2s），而
// loadPiAdapter / createRuntime / mcp / proxy 等热路径都会调用它。
// 按 5 分钟 TTL + 输入指纹缓存（与 piSystemApi 的 detect TTL 一致），
// 安装 / 强检通过 invalidatePiDetectCache() 或 force 参数失效。
// 异步化后并发调用会同时 miss 缓存，用同指纹的 in-flight promise 去重，
// 避免启动期（detect / loadPiAdapter / proxy 同时触发）重复 spawn 子进程。
const DETECT_TTL_MS = 5 * 60 * 1000;
let detectCache: { at: number; fingerprint: string; env: PiEnvironment } | null = null;
let detectInFlight: { fingerprint: string; promise: Promise<PiEnvironment> } | null = null;

function detectionFingerprint(): string {
  return [
    resolveUserPath(),
    devNpmRootOverride() ?? '',
    process.env.PI_DESKTOP_DEV_ALLOW_NON_NPM ?? '',
    process.env.PI_DESKTOP_DEV_PI_PACKAGE_ROOT ?? '',
    process.env.PI_DESKTOP_DEV_ALLOW_OUTDATED ?? '',
  ].join('\u0000');
}

export function invalidatePiDetectCache(): void {
  detectCache = null;
}

async function runDetection(fingerprint: string): Promise<PiEnvironment> {
  const node = await detectNode();
  const npm = node.found ? await detectNpm() : { found: false };
  const pi = npm.found
    ? detectDevPiOverride(npm) ?? await detectPi(npm)
    : { found: false, meetsMin: false };
  const env: PiEnvironment = {
    node,
    npm,
    pi,
    minNodeVersion: MIN_NODE_VERSION,
    minPiVersion: MIN_PI_VERSION,
  };
  detectCache = { at: Date.now(), fingerprint, env };
  return env;
}

export function detectPiEnvironment(force = false): Promise<PiEnvironment> {
  const fingerprint = detectionFingerprint();
  if (
    !force
    && detectCache
    && detectCache.fingerprint === fingerprint
    && Date.now() - detectCache.at < DETECT_TTL_MS
  ) {
    return Promise.resolve(detectCache.env);
  }
  if (!force && detectInFlight && detectInFlight.fingerprint === fingerprint) {
    return detectInFlight.promise;
  }
  const promise = runDetection(fingerprint).finally(() => {
    if (detectInFlight?.promise === promise) detectInFlight = null;
  });
  detectInFlight = { fingerprint, promise };
  return promise;
}
