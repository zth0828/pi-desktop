import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_PROXY_URL } from '../../shared/host-api/contract';

vi.mock('../../electron/services/proxy-api', () => ({
  resolveProxy: vi.fn(),
}));

const proxyApiMock = (await import('../../electron/services/proxy-api')) as unknown as {
  resolveProxy: ReturnType<typeof vi.fn>;
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
    globalFetchSpy.mockRestore();
  });

  it('passes dispatcher with ProxyAgent when proxy is configured', async () => {
    proxyApiMock.resolveProxy.mockResolvedValue({ url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    const res = await hostFetch('https://example.com/test', { headers: { accept: 'application/json' } });
    expect(res).toBeInstanceOf(Response);
    expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = globalFetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe('https://example.com/test');
    expect(callArgs[1]?.headers).toEqual({ accept: 'application/json' });
    expect((callArgs[1] as unknown as { dispatcher?: unknown })?.dispatcher).toBeDefined();
    globalFetchSpy.mockRestore();
  });
});
