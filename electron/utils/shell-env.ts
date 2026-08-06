// GUI 应用的 PATH 解析：macOS 上从 Finder 启动的 Electron 只有 /usr/bin:/bin 等
// 系统 PATH，拿不到用户 shell 里的 npm prefix / nvm / bun 路径。
// 这里通过 login shell 取一次真实 PATH 并缓存。
import { execFileSync } from 'node:child_process';
import os from 'node:os';

let cached: string | null = null;

export function resolveUserPath(): string {
  if (cached) return cached;
  // 测试钩子：E2E 用隔离 PATH 模拟各场景，不走 login shell
  const override = process.env.PI_DESKTOP_USER_PATH;
  if (override) {
    cached = override;
    return cached;
  }
  const envPath = process.env.PATH ?? '';
  if (process.platform === 'win32') {
    cached = envPath;
    return cached;
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const out = execFileSync(shell, ['-lic', 'echo -n "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // 合并去重：login shell PATH 优先，保留环境变量里的额外条目
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const entry of [...out.split(':'), ...envPath.split(':')]) {
      if (entry && !seen.has(entry)) {
        seen.add(entry);
        merged.push(entry);
      }
    }
    cached = merged.join(':') || envPath;
  } catch {
    cached = envPath;
  }
  return cached;
}

export function envWithUserPath(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: resolveUserPath() };
}

/** 测试专用：清缓存。 */
export function _resetUserPathCache(): void {
  cached = null;
}

export const homeDir = os.homedir();
