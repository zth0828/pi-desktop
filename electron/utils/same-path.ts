import { realpathSync } from 'node:fs';
import path from 'node:path';

function trimTrailingSlashes(p: string, isWin: boolean): string {
  if (isWin) {
    if (/^[a-zA-Z]:[/\\]?$/.test(p)) return p;
    return p.replace(/[/\\]+$/, '');
  }
  if (p === '/') return p;
  return p.replace(/\/+$/, '');
}

/**
 * 平台化路径比较：
 * - macOS /tmp → /private/tmp symlink：比较前两边 realpath
 * - Windows NTFS 大小写不敏感、分隔符可混用（/ 与 \）：归一化 + 小写后比较
 * - 尾斜杠差异（例如 /a/b/ 与 /a/b）视为同一路径
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
    const na = trimTrailingSlashes(path.win32.normalize(a), true).toLowerCase();
    const nb = trimTrailingSlashes(path.win32.normalize(b), true).toLowerCase();
    return na === nb;
  }
  const na = trimTrailingSlashes(path.posix.normalize(a), false);
  const nb = trimTrailingSlashes(path.posix.normalize(b), false);
  return na === nb;
}

function resolveNearestReal(target: string): string {
  const isWin = process.platform === 'win32';
  const resolved = isWin ? path.win32.resolve(target) : path.posix.resolve(target);
  const suffix: string[] = [];
  let parent = resolved;
  while (true) {
    const next = path.dirname(parent);
    if (next === parent) return resolved;
    suffix.unshift(path.basename(parent));
    parent = next;
    try {
      return path.join(realpathSync(parent), ...suffix);
    } catch {
      // 逐级向上查找存在的目录
    }
  }
}

export function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
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
