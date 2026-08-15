// 流式合帧节流（src/lib/stream-throttle.ts）单元测试：
// 窗口内同键 delta 合并为最新一条、关键事件直透且先 flush 积压保序、dispose 清定时器。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamBatcher, STREAM_FLUSH_MS, type StreamClass } from '@/lib/stream-throttle';

type Item = { type: string; key?: string; value: number };

const classify = (item: Item): StreamClass =>
  item.type === 'delta' ? { kind: 'delta', key: item.key ?? item.type } : { kind: 'immediate' };

describe('stream-throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('合并窗口内同键 delta，只应用最新一条', () => {
    const applied: Item[] = [];
    const batcher = createStreamBatcher<Item>((item) => applied.push(item), classify);
    batcher.push({ type: 'delta', value: 1 });
    batcher.push({ type: 'delta', value: 2 });
    batcher.push({ type: 'delta', value: 3 });
    expect(applied).toEqual([]); // 窗口未结束不应用
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(applied).toEqual([{ type: 'delta', value: 3 }]);
    batcher.dispose();
  });

  it('不同键的 delta 各自保留，按到达顺序应用', () => {
    const applied: Item[] = [];
    const batcher = createStreamBatcher<Item>((item) => applied.push(item), classify);
    batcher.push({ type: 'delta', key: 'a', value: 1 });
    batcher.push({ type: 'delta', key: 'b', value: 1 });
    batcher.push({ type: 'delta', key: 'a', value: 2 });
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(applied).toEqual([
      { type: 'delta', key: 'a', value: 2 },
      { type: 'delta', key: 'b', value: 1 },
    ]);
    batcher.dispose();
  });

  it('跨窗口的 delta 分批应用（每窗口一批）', () => {
    const applied: Item[] = [];
    const batcher = createStreamBatcher<Item>((item) => applied.push(item), classify);
    batcher.push({ type: 'delta', value: 1 });
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    batcher.push({ type: 'delta', value: 2 });
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(applied).toEqual([{ type: 'delta', value: 1 }, { type: 'delta', value: 2 }]);
    batcher.dispose();
  });

  it('关键事件直透，且先 flush 窗口内积压（保序）', () => {
    const applied: Item[] = [];
    const batcher = createStreamBatcher<Item>((item) => applied.push(item), classify);
    batcher.push({ type: 'delta', value: 1 });
    batcher.push({ type: 'run.ended', value: 0 });
    // 直透事件立即落地，且排在积压 delta 之后；定时器已消费，不再触发
    expect(applied).toEqual([{ type: 'delta', value: 1 }, { type: 'run.ended', value: 0 }]);
    vi.advanceTimersByTime(STREAM_FLUSH_MS * 2);
    expect(applied).toHaveLength(2);
    batcher.dispose();
  });

  it('dispose 清理定时器并丢弃积压', () => {
    const applied: Item[] = [];
    const batcher = createStreamBatcher<Item>((item) => applied.push(item), classify);
    batcher.push({ type: 'delta', value: 1 });
    batcher.dispose();
    vi.advanceTimersByTime(STREAM_FLUSH_MS * 2);
    expect(applied).toEqual([]);
    // dispose 后仍可复用（实例销毁语义下不会走到，防御性验证不炸）
    batcher.push({ type: 'delta', value: 2 });
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(applied).toEqual([{ type: 'delta', value: 2 }]);
    batcher.dispose();
  });
});
