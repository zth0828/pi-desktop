// 会话按项目（cwd）分组：侧栏 SessionList 与会话页 Sessions 共用。
import type { PiSessionRow } from '@shared/host-api/contract';

export type ProjectGroup = {
  cwd: string;
  name: string;
  sessions: PiSessionRow[];
  /** 组内最新 modified，用于组间排序 */
  latest: string;
};

export function groupByProject(sessions: PiSessionRow[]): ProjectGroup[] {
  const map = new Map<string, PiSessionRow[]>();
  for (const s of sessions) {
    const key = s.cwd || '(unknown)';
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return [...map.entries()]
    .map(([cwd, rows]) => ({
      cwd,
      name: cwd.split('/').filter(Boolean).pop() ?? cwd,
      sessions: rows,
      latest: rows[0]?.modified ?? '',
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}
