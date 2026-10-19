// GUI 应用的 PATH 解析：macOS 上从 Finder 启动的 Electron 只有 /usr/bin:/bin 等
// 系统 PATH，拿不到用户 shell 里的 npm prefix / nvm / bun 路径。
// 这里通过快速路径探测与后台 login shell 增量更新真实 PATH 并缓存。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cached: string | null = null;
let backgroundProbeStarted = false;

function expandWindowsEnvVars(entry: string): string {
  return entry.replace(/%([^%]+)%/g, (_, varName: string) => {
    const val = process.env[varName] || process.env[varName.toUpperCase()] || process.env[varName.toLowerCase()];
    return val ?? '';
  });
}

function readWindowsRegistryPath(key: string): string[] {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const match = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out);
    if (match && match[1]) {
      return match[1]
        .trim()
        .split(';')
        .map((entry) => expandWindowsEnvVars(entry.trim().replace(/^"(.*)"$/, '$1').trim()))
        .filter(Boolean);
    }
  } catch {
    // 忽略注册表查询异常（无权限或键不存在）
  }
  return [];
}

export function probeWindowsNodePaths(): string[] {
  const candidates: (string | undefined)[] = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs') : 'C:\\Program Files\\nodejs',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs') : 'C:\\Program Files (x86)\\nodejs',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : undefined,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Volta', 'bin') : undefined,
    process.env.NVM_HOME,
    process.env.NVM_SYMLINK,
  ];

  return candidates.filter((dir): dir is string => {
    if (!dir || dir.trim() === '' || dir === '.') return false;
    try {
      return existsSync(dir);
    } catch {
      return false;
    }
  });
}

export function probePosixNodePaths(): string[] {
  const home = os.homedir();
  const candidates: (string | undefined)[] = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(home, '.fnm', 'current', 'bin'),
    path.join(home, '.local', 'share', 'fnm', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.local', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (existsSync(nvmDir)) {
      const versions = readdirSync(nvmDir);
      if (versions.length > 0) {
        const sorted = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        candidates.push(path.join(nvmDir, sorted[0], 'bin'));
      }
    }
  } catch {
    // ignore
  }

  return candidates.filter((dir): dir is string => {
    if (!dir || dir.trim() === '' || dir === '.') return false;
    try {
      return existsSync(dir);
    } catch {
      return false;
    }
  });
}

function mergeWindowsPaths(pathsList: string[][]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of pathsList) {
    for (const entry of list) {
      const normalized = entry.trim().replace(/^"(.*)"$/, '$1').trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(normalized);
      }
    }
  }
  return merged.join(';');
}

function scheduleBackgroundShellPathProbe(basePath: string): void {
  if (backgroundProbeStarted) return;
  backgroundProbeStarted = true;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  import('node:child_process')
    .then((cp) => {
      if (!cp || typeof cp.execFile !== 'function') return;
      cp.execFile(
        shell,
        ['-lic', 'echo -n "$PATH"'],
        { encoding: 'utf8', timeout: 5000 },
        (err: unknown, stdout: unknown) => {
          if (!err && stdout && typeof stdout === 'string') {
            const seen = new Set<string>();
            const merged: string[] = [];
            for (const entry of [...stdout.trim().split(':'), ...(cached ?? basePath).split(':')]) {
              if (entry && !seen.has(entry)) {
                seen.add(entry);
                merged.push(entry);
              }
            }
            cached = merged.join(':');
            process.env.PATH = cached;
          }
        },
      );
    })
    .catch(() => {});
}

function resolvePosixShellPath(envPath: string): string {
  const probed = probePosixNodePaths();
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...envPath.split(':'), ...probed]) {
    if (entry && !seen.has(entry)) {
      seen.add(entry);
      merged.push(entry);
    }
  }
  const fastPath = merged.join(':') || envPath;
  scheduleBackgroundShellPathProbe(fastPath);
  return fastPath;
}

export function resolveUserPath(force = false): string {
  if (cached && !force) return cached;
  // 测试钩子：E2E 用隔离 PATH 模拟各场景，不走 login shell。
  // 空串也是合法覆盖值（模拟「无任何可用 PATH」），用 undefined 判定而非真值判定。
  const override = process.env.PI_DESKTOP_USER_PATH;
  if (override !== undefined) {
    cached = override;
    return cached;
  }
  const envPath = process.env.PATH ?? '';
  if (process.platform === 'win32') {
    // Windows 下外部安装程序（MSI/可执行文件）修改注册表但不通知当前运行中的进程，
    // 读取系统和用户注册表 PATH 并探测常见 node 路径进行合并去重
    const userRegPath = readWindowsRegistryPath('HKCU\\Environment');
    const systemRegPath = readWindowsRegistryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
    const probedPaths = probeWindowsNodePaths();
    cached = mergeWindowsPaths([envPath.split(';'), userRegPath, systemRegPath, probedPaths]);
    process.env.PATH = cached;
    return cached;
  }
  cached = resolvePosixShellPath(envPath);
  return cached;
}

export function refreshUserPath(): string {
  cached = null;
  backgroundProbeStarted = false;
  return resolveUserPath(true);
}

export function envWithUserPath(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const userPath = resolveUserPath();
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, PATH: userPath };
  if (process.platform === 'win32') {
    env.Path = userPath;
  }
  return env;
}

/** 测试专用：清缓存。 */
export function _resetUserPathCache(): void {
  cached = null;
  backgroundProbeStarted = false;
}

export const homeDir = os.homedir();
