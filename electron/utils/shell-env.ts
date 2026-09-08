// GUI 应用的 PATH 解析：macOS 上从 Finder 启动的 Electron 只有 /usr/bin:/bin 等
// 系统 PATH，拿不到用户 shell 里的 npm prefix / nvm / bun 路径。
// 这里通过 login shell 取一次真实 PATH 并缓存。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cached: string | null = null;

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
    });
    const match = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out);
    if (match && match[1]) {
      return match[1]
        .trim()
        .split(';')
        .map((entry) => expandWindowsEnvVars(entry.trim()))
        .filter(Boolean);
    }
  } catch {
    // 忽略注册表查询异常（无权限或键不存在）
  }
  return [];
}

function probeWindowsNodePaths(): string[] {
  const candidates: string[] = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs'),
    path.join(process.env.APPDATA ?? '', 'npm'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Volta', 'bin'),
    path.join(process.env.NVM_HOME ?? ''),
    path.join(process.env.NVM_SYMLINK ?? ''),
  ].filter(Boolean);

  return candidates.filter((dir) => {
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
      const normalized = entry.trim();
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

function resolvePosixShellPath(envPath: string): string {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const out = execFileSync(shell, ['-lic', 'echo -n "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const entry of [...out.split(':'), ...envPath.split(':')]) {
      if (entry && !seen.has(entry)) {
        seen.add(entry);
        merged.push(entry);
      }
    }
    return merged.join(':') || envPath;
  } catch {
    return envPath;
  }
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
  return resolveUserPath(true);
}

export function envWithUserPath(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: resolveUserPath() };
}

/** 测试专用：清缓存。 */
export function _resetUserPathCache(): void {
  cached = null;
}

export const homeDir = os.homedir();
