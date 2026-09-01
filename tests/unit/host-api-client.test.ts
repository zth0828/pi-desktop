// host-api-client：失败响应错误码透传与渲染层超时（默认 30s + 慢操作豁免）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeHost } from '@/lib/host-api-client';

const hostInvokeMock = vi.fn();

beforeEach(() => {
  hostInvokeMock.mockReset();
  (globalThis as { window?: unknown }).window = {
    pidesktop: { hostInvoke: hostInvokeMock },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (error: unknown) => error,
  );
}

describe('invokeHost 错误码透传', () => {
  it('失败响应把 code 挂到抛出的 Error 上', async () => {
    hostInvokeMock.mockResolvedValue({
      ok: false,
      error: { code: 'MODEL_UNAVAILABLE', message: 'provider model missing' },
    });
    const error = await rejectionOf(invokeHost('app', 'version')) as { code?: string; message: string };
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('MODEL_UNAVAILABLE');
    expect(error.message).toBe('provider model missing');
  });

  it('错误信封缺省 error 时 code 为 undefined，消息带模块与 action', async () => {
    hostInvokeMock.mockResolvedValue({ ok: false });
    const error = await rejectionOf(invokeHost('app', 'version')) as { code?: string; message: string };
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('Host request failed: app.version');
  });
});

describe('invokeHost 超时', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bridge 永挂时默认 30s 超时，code 为 host-invoke-timeout', async () => {
    vi.useFakeTimers();
    hostInvokeMock.mockImplementation(() => new Promise(() => {}));
    const pending = invokeHost('app', 'version');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'host-invoke-timeout' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('慢操作豁免表：piRuntime.start 用 90s 而非默认 30s', async () => {
    vi.useFakeTimers();
    hostInvokeMock.mockImplementation(() => new Promise(() => {}));
    const pending = invokeHost('piRuntime', 'start', { cwd: '/tmp' });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'host-invoke-timeout',
      message: expect.stringContaining('90000ms'),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('正常返回后清理超时定时器', async () => {
    vi.useFakeTimers();
    hostInvokeMock.mockResolvedValue({ ok: true, data: '1.0.0' });
    await expect(invokeHost('app', 'version')).resolves.toBe('1.0.0');
    expect(vi.getTimerCount()).toBe(0);
  });
});
