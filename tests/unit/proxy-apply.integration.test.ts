import { beforeEach, describe, expect, it, vi } from 'vitest';

// 集成验证：真实 applyProxyToPi（真实 pi-detector + 真实 http-dispatcher），
// 只 mock壳设置。验证 Pi Desktop URL 覆盖启动环境并安装全局 dispatcher。
vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: { getAll: vi.fn() },
}));

const settingsApiMock = (await import('../../electron/services/settings-api')).settingsApi as unknown as {
  getAll: ReturnType<typeof vi.fn>;
};
const { applyProxyToPi } = await import('../../electron/services/proxy-api');

beforeEach(() => {
  vi.clearAllMocks();
  settingsApiMock.getAll.mockResolvedValue({
    httpProxyMode: 'auto',
    httpProxyUrl: 'http://127.0.0.1:7897',
  });
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.ALL_PROXY;
});

describe('applyProxyToPi against the real pi runtime', () => {
  it('applies the Pi Desktop proxy to the pi global dispatcher', async () => {
    const result = await applyProxyToPi();
    expect(result.success).toBe(true);
    expect(result.detail).toContain('http://127.0.0.1:7897');
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7897');
  });

  it('overrides proxy values inherited from the launch environment', async () => {
    process.env.HTTP_PROXY = 'http://127.0.0.1:9999';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';
    process.env.ALL_PROXY = 'http://127.0.0.1:9999';
    const result = await applyProxyToPi();
    expect(result.success).toBe(true);
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7897');
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7897');
    expect(process.env.ALL_PROXY).toBeUndefined();
  });

  it('clears inherited proxy variables when mode is off', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'off' });
    process.env.HTTP_PROXY = 'http://127.0.0.1:9999';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';
    process.env.ALL_PROXY = 'http://127.0.0.1:9999';
    const result = await applyProxyToPi();
    expect(result.success).toBe(true);
    expect(result.detail).toBe('off');
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
    expect(process.env.ALL_PROXY).toBeUndefined();
  });
});
