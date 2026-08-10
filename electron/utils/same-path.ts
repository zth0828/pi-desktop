import { realpathSync } from 'node:fs';

/** macOS /tmp → /private/tmp symlink：路径比较前两边 realpath（AGENTS.md）。 */
export function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
