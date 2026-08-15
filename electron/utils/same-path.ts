import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * 平台化路径比较：
 * - macOS /tmp → /private/tmp symlink：比较前两边 realpath
 * - Windows NTFS 大小写不敏感、分隔符可混用（/ 与 \）：归一化 + 小写后比较
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
    return path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  }
  return path.posix.normalize(a) === path.posix.normalize(b);
}

export function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (pathsEqual(a, b)) return true;
  try {
    return pathsEqual(realpathSync(a), realpathSync(b));
  } catch {
    return false;
  }
}
