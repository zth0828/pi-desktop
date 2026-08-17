// trust.json 解析单测：合法记录过滤、排序、坏输入兜底。
import { describe, expect, it } from 'vitest';
import { parseTrustEntries } from '../../electron/utils/trust-entries';

describe('trust-entries', () => {
  it('解析 path→decision 记录并按路径排序', () => {
    const entries = parseTrustEntries(JSON.stringify({ '/b': false, '/a': true }));
    expect(entries).toEqual([
      { path: '/a', decision: true },
      { path: '/b', decision: false },
    ]);
  });

  it('忽略非布尔值（null 撤销位不展示）', () => {
    expect(parseTrustEntries(JSON.stringify({ '/a': true, '/b': null, '/c': 'yes' })))
      .toEqual([{ path: '/a', decision: true }]);
  });

  it('坏 JSON / 非对象输入返回空列表', () => {
    expect(parseTrustEntries('not json')).toEqual([]);
    expect(parseTrustEntries('[]')).toEqual([]);
    expect(parseTrustEntries('null')).toEqual([]);
  });
});
