// trust.json 解析：pi ProjectTrustStore 无全量列举 API（文件格式 = path→decision 的 JSON 对象），
// Settings 页列表需要全量读。写入仍走 ProjectTrustStore（带锁），这里只负责只读解析。
import type { PiTrustEntry } from '@shared/host-api/contract';

export function parseTrustEntries(jsonText: string): PiTrustEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    .map(([entryPath, decision]) => ({ path: entryPath, decision }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
