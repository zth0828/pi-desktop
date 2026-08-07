import { describe, expect, it } from 'vitest';
import { cacheHitRate, formatCost, formatHitRate, summarizeUsage } from '../../src/lib/usage-stats';

describe('summarizeUsage', () => {
  it('accumulates tokens, cost and keeps the last turn usage', () => {
    const messages = [
      { raw: { role: 'user' } },
      {
        raw: {
          role: 'assistant',
          usage: {
            input: 100,
            output: 10,
            cacheRead: 800,
            cacheWrite: 100,
            cost: { input: 0.001, output: 0.0005, cacheRead: 0.0008, cacheWrite: 0.0012, total: 0.0035 },
          },
        },
      },
      {
        raw: {
          role: 'assistant',
          usage: {
            input: 50,
            output: 5,
            cacheRead: 900,
            cacheWrite: 50,
            cost: { total: 0.0015 },
          },
        },
      },
    ];
    const totals = summarizeUsage(messages);
    expect(totals.input).toBe(150);
    expect(totals.output).toBe(15);
    expect(totals.cacheRead).toBe(1700);
    expect(totals.cacheWrite).toBe(150);
    expect(totals.cost).toBeCloseTo(0.005);
    expect(totals.lastTurn).toEqual({ input: 50, output: 5, cacheRead: 900, cacheWrite: 50 });
  });

  it('supports openai-style prompt_tokens/completion_tokens fallback', () => {
    const totals = summarizeUsage([
      { raw: { usage: { prompt_tokens: 7, completion_tokens: 3 } } },
    ]);
    expect(totals.input).toBe(7);
    expect(totals.output).toBe(3);
    expect(totals.cost).toBe(0);
  });

  it('returns zero totals and null lastTurn without usage', () => {
    const totals = summarizeUsage([{ raw: { role: 'user' } }, { raw: undefined }]);
    expect(totals).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, lastTurn: null });
  });
});

describe('cacheHitRate', () => {
  it('computes cacheRead / (input + cacheRead + cacheWrite)', () => {
    expect(cacheHitRate({ input: 100, cacheRead: 800, cacheWrite: 100 })).toBeCloseTo(0.8);
  });

  it('returns null when the denominator is zero', () => {
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe('formatHitRate / formatCost', () => {
  it('formats hit rate as a rounded percent', () => {
    expect(formatHitRate(0.8333)).toBe('83%');
  });

  it('formats cost with 4 decimals below $1 and 2 decimals above', () => {
    expect(formatCost(0.0035)).toBe('$0.0035');
    expect(formatCost(12.3456)).toBe('$12.35');
  });
});
