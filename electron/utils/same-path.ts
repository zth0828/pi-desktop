import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * 剥离 Windows 扩展长度路径前缀（\\?\ 与 \\?\UNC\）。
 * Node 的 realpathSync 在 Windows 上常返回带 \\?\ 前缀的规范路径，
 * 需与常规驱动器路径拉齐后再比对。
 */
export function stripWindowsExtendedPrefix(p: string): string {
  if (/^(?:[\\/]{2}\?[\\/]|[\\/]\?\?[\\/])unc[\\/]/i.test(p)) {
    return `\\\\${p.slice(8)}`;
  }
  if (/^(?:[\\/]{2}\?[\\/]|[\\/]\?\?[\\/])/i.test(p)) {
    return p.slice(4);
  }
  return p;
}

function trimTrailingSlashes(p: string, isWin: boolean): string {
  if (isWin) {
    return p.replace(/[/\\]+$/, '');
  }
  if (p === '/') return p;
  return p.replace(/\/+$/, '');
}

function normalizeWin32Path(p: string): string {
  const stripped = stripWindowsExtendedPrefix(p);
  if (/^[a-zA-Z]:[/\\]*$/.test(stripped)) {
    return `${stripped.slice(0, 2)}\\`.toLowerCase();
  }
  return trimTrailingSlashes(path.win32.normalize(stripped), true).toLowerCase();
}

/**
 * 平台化路径比较：
 * - macOS /tmp → /private/tmp symlink：比较前两边 realpath
 * - Windows NTFS 大小写不敏感、分隔符可混用（/ 与 \）：归一化 + 小写后比较
 * - 尾斜杠差异（例如 /a/b/ 与 /a/b）与驱动器根（C: 与 C:\ 与 C:\\）视为同一路径
 * - 支持 Windows 扩展长度路径前缀（\\?\ 与 \\?\UNC\）
 * 纯比较逻辑抽成 pathsEqual 便于单测（mac 上可注入 win32 语义）；
 * 8.3 短名 realpath 不展开。
 */
export function pathsEqual(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (a === b) return true;
  if (platform === 'win32') {
    const na = normalizeWin32Path(a);
    const nb = normalizeWin32Path(b);
    return na === nb;
  }
  const na = trimTrailingSlashes(path.posix.normalize(a), false);
  const nb = trimTrailingSlashes(path.posix.normalize(b), false);
  return na === nb;
}

function resolveNearestReal(target: string): string {
  const isWin = process.platform === 'win32';
  const clean = isWin ? stripWindowsExtendedPrefix(target) : target;
  const resolved = isWin ? path.win32.resolve(clean) : path.posix.resolve(clean);
  try {
    const real = realpathSync(resolved);
    return isWin ? stripWindowsExtendedPrefix(real) : real;
  } catch {
    // 目标不存在时逐级向上查找存在的目录
  }
  const suffix: string[] = [];
  let parent = resolved;
  while (true) {
    const next = path.dirname(parent);
    if (next === parent) return resolved;
    suffix.unshift(path.basename(parent));
    parent = next;
    try {
      const realParent = realpathSync(parent);
      const joined = isWin ? path.win32.join(realParent, ...suffix) : path.posix.join(realParent, ...suffix);
      return isWin ? stripWindowsExtendedPrefix(joined) : joined;
    } catch {
      // 逐级向上查找存在的目录
    }
  }
}

export function samePath(a?: string, b?: string): boolean {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  if (pathsEqual(a, b)) return true;
  try {
    return pathsEqual(realpathSync(a), realpathSync(b));
  } catch {
    //
  }
  try {
    return pathsEqual(resolveNearestReal(a), resolveNearestReal(b));
  } catch {
    return false;
  }
}
