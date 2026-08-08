import { describe, expect, it } from 'vitest';
import {
  CACHE_MISS_NOISE_FLOOR,
  CACHE_TTL_MS,
  collectCacheMisses,
  formatTokenCount,
} from '../../src/lib/cache-stats';

const T0 = 1_786_006_701_982;

function assistant(
  usage: { input: number; cacheRead?: number; cacheWrite?: number; cost?: Record<string, number> },
  timestamp = T0,
  model = 'mock/mock-1',
) {
  const [provider, modelId] = model.split('/');
  return {
    role: 'assistant',
    raw: {
      role: 'assistant',
      provider,
      model: modelId,
      timestamp,
      usage: {
        input: usage.input,
        output: 5,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, ...usage.cost },
      },
    },
  };
}

const user = { role: 'user', raw: { role: 'user' } };

describe('collectCacheMisses', () => {
  it('首轮没有对比基准，不计 miss', () => {
    const misses = collectCacheMisses([user, assistant({ input: 5000 })]);
    expect(misses.size).toBe(0);
  });

  it('缓存正常命中时不计 miss', () => {
    const misses = collectCacheMisses([
      assistant({ input: 100, cacheWrite: 5000 }),
      assistant({ input: 50, cacheRead: 5050 }),
    ]);
    expect(misses.size).toBe(0);
  });

  it('上一轮有缓存上报、本轮零缓存 → 整轮 miss（min(prev,cur)-cacheRead）', () => {
    const messages = [
      user,
      assistant({ input: 0, cacheWrite: 6000 }, T0),
      user,
      assistant({ input: 6100 }, T0 + 60_000),
    ];
    const misses = collectCacheMisses(messages);
    expect(misses.size).toBe(1);
    const miss = misses.get(3)!;
    expect(miss.missedTokens).toBe(6000);
    expect(miss.idleMs).toBe(60_000);
    expect(miss.modelChanged).toBe(false);
  });

  it('部分命中时只计未命中部分', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 8000 }, T0),
      assistant({ input: 3500, cacheRead: 5000 }, T0 + 1000),
    ];
    const miss = collectCacheMisses(messages).get(1)!;
    // min(prev=8000, cur=8500) - cacheRead=5000
    expect(miss.missedTokens).toBe(3000);
  });

  it('miss 低于噪声阈值（1024）不计', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 2000 }, T0),
      assistant({ input: 1000, cacheRead: 1200 }, T0 + 1000),
    ];
    expect(2000 - 1200).toBeLessThanOrEqual(CACHE_MISS_NOISE_FLOOR);
    expect(collectCacheMisses(messages).size).toBe(0);
  });

  it('provider 从未上报缓存（两轮全零）→ 不计', () => {
    const messages = [assistant({ input: 5000 }, T0), assistant({ input: 6000 }, T0 + 1000)];
    expect(collectCacheMisses(messages).size).toBe(0);
  });

  it('compaction 摘要重置基准：下一轮是新上下文，不计 miss', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 6000 }, T0),
      { role: 'compactionSummary', raw: { role: 'compactionSummary', summary: 'x' } },
      assistant({ input: 3000 }, T0 + 1000),
    ];
    expect(collectCacheMisses(messages).size).toBe(0);
  });

  it('切换模型不豁免（全量重计费计入）', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 6000 }, T0, 'mock/a'),
      assistant({ input: 6000 }, T0 + 1000, 'mock/b'),
    ];
    const miss = collectCacheMisses(messages).get(1)!;
    expect(miss.missedTokens).toBe(6000);
    expect(miss.modelChanged).toBe(true);
  });

  it('missedCost = missedTokens ×（付费费率 − 缓存读费率）', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 4000 }, T0),
      assistant(
        { input: 3000, cacheRead: 2000, cost: { input: 0.03, cacheWrite: 0, cacheRead: 0.002 } },
        T0 + 1000,
      ),
    ];
    // missed = min(4000, 5000) - 2000 = 2000；paid = 0.03/3000，read = 0.002/2000
    const miss = collectCacheMisses(messages).get(1)!;
    expect(miss.missedTokens).toBe(2000);
    expect(miss.missedCost).toBeCloseTo(2000 * (0.03 / 3000 - 0.002 / 2000));
  });

  it('无 usage 的消息跳过且不打断对比链', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 6000 }, T0),
      { role: 'assistant', raw: { role: 'assistant' } },
      assistant({ input: 6000 }, T0 + 1000),
    ];
    expect(collectCacheMisses(messages).get(2)?.missedTokens).toBe(6000);
  });

  it('闲置超过缓存 TTL 时 idleMs 可供归因展示', () => {
    const messages = [
      assistant({ input: 0, cacheWrite: 6000 }, T0),
      assistant({ input: 6000 }, T0 + CACHE_TTL_MS + 60_000),
    ];
    const miss = collectCacheMisses(messages).get(1)!;
    expect(miss.idleMs).toBeGreaterThan(CACHE_TTL_MS);
  });
});

describe('formatTokenCount', () => {
  it('k/M 紧凑格式', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(45_200)).toBe('45.2k');
    expect(formatTokenCount(6000)).toBe('6.0k');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
  });
});
