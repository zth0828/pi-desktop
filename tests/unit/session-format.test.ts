import { describe, expect, it } from 'vitest';
import { formatRelativeTime, sessionDisplayTitle } from '../../src/lib/session-format';

describe('sessionDisplayTitle — 会话列表标题', () => {
  it('有 name 优先用 name', () => {
    expect(sessionDisplayTitle({ name: 'My Session', firstMessage: 'hello' })).toBe('My Session');
  });

  it('无 name 用 firstMessage', () => {
    expect(sessionDisplayTitle({ firstMessage: 'fix the bug' })).toBe('fix the bug');
  });

  it('firstMessage 超长截断并加省略号', () => {
    const long = 'a'.repeat(100);
    const title = sessionDisplayTitle({ firstMessage: long });
    expect(title).toHaveLength(61);
    expect(title.endsWith('…')).toBe(true);
  });

  it('多行/多余空白折叠为单行', () => {
    expect(sessionDisplayTitle({ firstMessage: 'line1\n  line2' })).toBe('line1 line2');
  });

  it('name 和 firstMessage 都为空 → 空串（调用方兜底文案）', () => {
    expect(sessionDisplayTitle({ name: '  ', firstMessage: '' })).toBe('');
  });
});

describe('formatRelativeTime — 相对时间', () => {
  const now = new Date('2026-08-06T12:00:00Z').getTime();

  it('几分钟前（en）', () => {
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso, now, 'en')).toBe('5 minutes ago');
  });

  it('几小时前（zh）', () => {
    const iso = new Date(now - 3 * 3_600_000).toISOString();
    expect(formatRelativeTime(iso, now, 'zh')).toBe('3小时前');
  });

  it('几天前（en）', () => {
    const iso = new Date(now - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(iso, now, 'en')).toBe('2 days ago');
  });

  it('刚刚 → now', () => {
    const iso = new Date(now - 5_000).toISOString();
    expect(formatRelativeTime(iso, now, 'en')).toBe('now');
  });
});
