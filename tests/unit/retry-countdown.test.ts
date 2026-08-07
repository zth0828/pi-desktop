import { describe, expect, it } from 'vitest';
import { retryRemainingSeconds } from '../../src/lib/retry-countdown';

describe('retryRemainingSeconds', () => {
  const startedAt = 1_000_000;

  it('按 delayMs 本地倒数（向上取整）', () => {
    const retry = { startedAt, delayMs: 8000 };
    expect(retryRemainingSeconds(retry, startedAt)).toBe(8);
    expect(retryRemainingSeconds(retry, startedAt + 100)).toBe(8);
    expect(retryRemainingSeconds(retry, startedAt + 1000)).toBe(7);
    expect(retryRemainingSeconds(retry, startedAt + 7900)).toBe(1);
  });

  it('到期后不为负', () => {
    const retry = { startedAt, delayMs: 8000 };
    expect(retryRemainingSeconds(retry, startedAt + 8000)).toBe(0);
    expect(retryRemainingSeconds(retry, startedAt + 60_000)).toBe(0);
  });

  it('无 delayMs 返回 null（不显示倒计时）', () => {
    expect(retryRemainingSeconds({ startedAt }, startedAt)).toBeNull();
  });
});
