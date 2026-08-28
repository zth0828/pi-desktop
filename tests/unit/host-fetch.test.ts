import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_PROXY_URL } from '../../shared/host-api/contract';

vi.mock('../../electron/services/proxy-api', () => ({
  resolveProxy: vi.fn(),
}));

// 代理分支用 undici 包自己的 fetch（dispatcher 与 ProxyAgent 必须同实例，
// Node 内置全局 fetch 不认外部 ProxyAgent），这里拦截它验证调用参数。
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: vi.fn() };
});

const proxyApiMock = (await import('../../electron/services/proxy-api')) as unknown as {
  resolveProxy: ReturnType<typeof vi.fn>;
};
const undiciMock = (await import('undici')) as unknown as {
  fetch: ReturnType<typeof vi.fn>;
};

const { hostFetch } = await import('../../electron/utils/host-fetch');

describe('hostFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses direct fetch when proxy is disabled', async () => {
    proxyApiMock.resolveProxy.mockResolvedValue({ source: 'off' });
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    const res = await hostFetch('https://example.com/test');
    expect(res).toBeInstanceOf(Response);
    expect(globalFetchSpy).toHaveBeenCalledWith('https://example.com/test', undefined);
    expect(undiciMock.fetch).not.toHaveBeenCalled();
    globalFetchSpy.mockRestore();
  });

  it('passes dispatcher with ProxyAgent when proxy is configured', async () => {
    proxyApiMock.resolveProxy.mockResolvedValue({ url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    undiciMock.fetch.mockResolvedValue(new Response('proxied') as never);

    const res = await hostFetch('https://example.com/test', { headers: { accept: 'application/json' } });
    // 代理分支走 undici fetch（不走全局 fetch），携带同实例的 ProxyAgent dispatcher
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(undiciMock.fetch).toHaveBeenCalledTimes(1);
    const callArgs = undiciMock.fetch.mock.calls[0] as unknown as [
      string,
      { headers?: Record<string, string>; dispatcher?: unknown },
    ];
    expect(callArgs[0]).toBe('https://example.com/test');
    expect(callArgs[1]?.headers).toEqual({ accept: 'application/json' });
    expect(callArgs[1]?.dispatcher).toBeInstanceOf(
      (await import('undici')).ProxyAgent,
    );
    expect(await res.text()).toBe('proxied');
    globalFetchSpy.mockRestore();
  });

  it('bypasses proxy for loopback addresses even when proxy is configured', async () => {
    proxyApiMock.resolveProxy.mockResolvedValue({ url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('local'));
    undiciMock.fetch.mockResolvedValue(new Response('proxied') as never);

    const res = await hostFetch('http://127.0.0.1:8080/models');
    expect(await res.text()).toBe('local');
    expect(globalFetchSpy).toHaveBeenCalledWith('http://127.0.0.1:8080/models', undefined);
    expect(undiciMock.fetch).not.toHaveBeenCalled();
    globalFetchSpy.mockRestore();
  });

  it('falls back to direct fetch when proxy connection throws', async () => {
    proxyApiMock.resolveProxy.mockResolvedValue({ url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('direct-fallback'));
    undiciMock.fetch.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:7897'));

    const res = await hostFetch('https://example.com/test');
    expect(await res.text()).toBe('direct-fallback');
    expect(globalFetchSpy).toHaveBeenCalledWith('https://example.com/test', undefined);
    globalFetchSpy.mockRestore();
  });
});
