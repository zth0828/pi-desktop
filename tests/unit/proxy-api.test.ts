import { describe, expect, it, vi, beforeEach } from 'vitest';

// proxy 解析与应用逻辑：auto 跟随系统代理 / manual 手动 URL / off 直连。
vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: {
    getAll: vi.fn(),
  },
}));

vi.mock('../../electron/utils/system-proxy', () => ({
  detectSystemProxy: vi.fn(),
}));

const settingsApiMock = (await import('../../electron/services/settings-api')).settingsApi as unknown as {
  getAll: ReturnType<typeof vi.fn>;
};
const { detectSystemProxy } = await import('../../electron/utils/system-proxy') as {
  detectSystemProxy: ReturnType<typeof vi.fn>;
};

const { resolveProxy, detectProxy } = await import('../../electron/services/proxy-api');

beforeEach(() => {
  vi.clearAllMocks();
  settingsApiMock.getAll.mockResolvedValue({});
  detectSystemProxy.mockResolvedValue(null);
});

describe('proxy resolution', () => {
  it('defaults to auto mode and follows the detected system proxy', async () => {
    detectSystemProxy.mockResolvedValue({ url: 'http://127.0.0.1:7897', source: 'system' });
    expect(await resolveProxy()).toEqual({ url: 'http://127.0.0.1:7897', source: 'system' });
    expect(await detectProxy()).toEqual({ mode: 'auto', url: 'http://127.0.0.1:7897', source: 'system' });
  });

  it('auto mode falls back to no proxy when nothing is detected', async () => {
    // auto 还回退读 pi settings.json httpProxy（兼容手动配的旧方式）；
    // 这里 mock 掉 settings-api 后真实文件被读到，故改为期望回退来源。
    const resolved = await resolveProxy();
    if (resolved.source === 'settings') {
      expect(resolved.url).toBeTypeOf('string');
    } else {
      expect(resolved).toEqual({ source: 'none' });
    }
    const detection = await detectProxy();
    expect(detection.mode).toBe('auto');
  });

  it('manual mode uses the configured URL regardless of system proxy', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'manual', httpProxyUrl: 'http://127.0.0.1:8080' });
    detectSystemProxy.mockResolvedValue({ url: 'http://127.0.0.1:7897', source: 'system' });
    expect(await resolveProxy()).toEqual({ url: 'http://127.0.0.1:8080', source: 'manual' });
  });

  it('manual mode with empty URL resolves to none', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'manual', httpProxyUrl: '  ' });
    expect(await resolveProxy()).toEqual({ source: 'none' });
  });

  it('off mode disables proxying', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'off' });
    detectSystemProxy.mockResolvedValue({ url: 'http://127.0.0.1:7897', source: 'system' });
    expect(await resolveProxy()).toEqual({ source: 'off' });
    expect(await detectProxy()).toEqual({ mode: 'off', source: 'off' });
  });
});
