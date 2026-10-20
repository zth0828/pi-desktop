// 会话按项目（cwd）分组：侧栏 SessionList 与会话页 Sessions 共用。
import type { PiSessionRow } from '@shared/host-api/contract';

export const SCRATCHPAD_GROUP_KEY = '__scratchpad__';

export function isScratchpadCwd(cwd?: string | null): boolean {
  if (!cwd) return false;
  const normalized = cwd.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/.pi/scratchpad');
}

export function getProjectName(cwd?: string): string {
  if (!cwd) return '';
  if (isScratchpadCwd(cwd)) return SCRATCHPAD_GROUP_KEY;
  // Windows 路径用 `\` 分隔，两种分隔符都要切
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

export type ProjectGroup = {
  cwd: string;
  name: string;
  sessions: PiSessionRow[];
  /** 组内最新 modified，用于组间排序 */
  latest: string;
  /** 工作目录在本地文件系统是否存在 */
  cwdExists?: boolean;
};

export function groupByProject(sessions: PiSessionRow[]): ProjectGroup[] {
  const map = new Map<string, PiSessionRow[]>();
  for (const s of sessions) {
    if (s.messageCount <= 0) continue;
    const key = isScratchpadCwd(s.cwd) ? SCRATCHPAD_GROUP_KEY : (s.cwd || '(unknown)');
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return [...map.entries()]
    .map(([cwd, rows]) => {
      const sortedRows = [...rows].sort((a, b) => {
        if (Boolean(b.pinned) !== Boolean(a.pinned)) {
          return b.pinned ? 1 : -1;
        }
        return b.modified.localeCompare(a.modified);
      });
      const cwdExists = rows.every((r) => r.cwdExists !== false);
      return {
        cwd,
        name: cwd === SCRATCHPAD_GROUP_KEY ? SCRATCHPAD_GROUP_KEY : getProjectName(cwd),
        sessions: sortedRows,
        latest: sortedRows[0]?.modified ?? '',
        cwdExists,
      };
    })
    .sort((a, b) => {
      if (a.cwd === SCRATCHPAD_GROUP_KEY) return -1;
      if (b.cwd === SCRATCHPAD_GROUP_KEY) return 1;
      return b.latest.localeCompare(a.latest);
    });
}
