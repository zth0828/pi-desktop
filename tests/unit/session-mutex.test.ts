// session-mutex：同 key 串行、跨 key 并行、前序失败放行、结果原样传递。
import { describe, expect, it } from 'vitest';
import { serializeSessionOp } from '@electron/services/session-mutex';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('serializeSessionOp', () => {
  it('同 key 的操作按提交顺序串行执行，后者等前者完成', async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const first = serializeSessionOp('k', async () => {
      order.push('1:start');
      await gate.promise;
      order.push('1:end');
      return 'a';
    });
    const second = serializeSessionOp('k', async () => {
      order.push('2:start');
      return 'b';
    });
    // 放行两条微任务让第一个 op 启动并挂起
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['1:start']);
    gate.resolve();
    expect(await first).toBe('a');
    expect(await second).toBe('b');
    expect(order).toEqual(['1:start', '1:end', '2:start']);
  });

  it('前序操作失败不阻塞后续排队者，失败原因原样传给调用方', async () => {
    const order: string[] = [];
    const first = serializeSessionOp('k', async () => {
      order.push('1');
      throw new Error('boom');
    });
    const second = serializeSessionOp('k', async () => {
      order.push('2');
      return 'ok';
    });
    await expect(first).rejects.toThrow('boom');
    expect(await second).toBe('ok');
    expect(order).toEqual(['1', '2']);
  });

  it('不同 key 互不阻塞：key A 挂起期间 key B 直接执行', async () => {
    const gate = deferred<void>();
    const first = serializeSessionOp('a', () => gate.promise.then(() => 'a'));
    const second = serializeSessionOp('b', async () => 'b');
    expect(await second).toBe('b');
    gate.resolve();
    expect(await first).toBe('a');
  });

  it('链清理后同 key 可继续排队（注册表不残留死链）', async () => {
    expect(await serializeSessionOp('k', async () => 1)).toBe(1);
    expect(await serializeSessionOp('k', async () => 2)).toBe(2);
    await expect(serializeSessionOp('k', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await serializeSessionOp('k', async () => 3)).toBe(3);
  });
});
