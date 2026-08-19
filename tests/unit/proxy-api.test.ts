import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_PROXY_URL } from '../../shared/host-api/contract';

// 代理只由 Pi Desktop 设置解析：auto 使用配置地址，off 直连。
vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: {
    getAll: vi.fn(),
  },
}));

const settingsApiMock = (await import('../../electron/services/settings-api')).settingsApi as unknown as {
  getAll: ReturnType<typeof vi.fn>;
};

const { resolveProxy, detectProxy } = await import('../../electron/services/proxy-api');

beforeEach(() => {
  vi.clearAllMocks();
  settingsApiMock.getAll.mockResolvedValue({});
});

describe('proxy resolution', () => {
  it('defaults to the Pi Desktop proxy URL', async () => {
    expect(await resolveProxy()).toEqual({ url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
    expect(await detectProxy()).toEqual({ mode: 'auto', url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
  });

  it('auto mode uses the configured Pi Desktop URL', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'auto', httpProxyUrl: 'http://127.0.0.1:8080' });
    expect(await resolveProxy()).toEqual({ url: 'http://127.0.0.1:8080', source: 'app' });
  });

  it('auto mode falls back to the default when the configured URL is empty', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'auto', httpProxyUrl: '  ' });
    expect(await resolveProxy()).toEqual({ url: DEFAULT_DESKTOP_PROXY_URL, source: 'app' });
  });

  it('legacy manual mode is migrated to enabled auto semantics', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'manual', httpProxyUrl: 'http://127.0.0.1:8080' });
    expect(await detectProxy()).toEqual({ mode: 'auto', url: 'http://127.0.0.1:8080', source: 'app' });
  });

  it('off mode disables proxying', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'off', httpProxyUrl: 'http://127.0.0.1:7897' });
    expect(await resolveProxy()).toEqual({ source: 'off' });
    expect(await detectProxy()).toEqual({ mode: 'off', source: 'off' });
  });
});
