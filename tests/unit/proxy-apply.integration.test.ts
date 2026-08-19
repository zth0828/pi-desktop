import { describe, expect, it, vi, beforeEach } from 'vitest';

// 集成验证：真实 applyProxyToPi（真实 pi-detector + 真实 http-dispatcher），
// 只 mock 壳设置与系统代理检测。验证代理 URL 被写入 env 并安装全局 dispatcher。
vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: { getAll: vi.fn() },
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
const { applyProxyToPi } = await import('../../electron/services/proxy-api');

beforeEach(() => {
  vi.clearAllMocks();
  settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'auto' });
  detectSystemProxy.mockResolvedValue({ url: 'http://127.0.0.1:7897', source: 'system' });
  // 避免污染其他测试：恢复 env
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
});

describe('applyProxyToPi against the real pi runtime', () => {
  it('applies the detected proxy to the pi global dispatcher', async () => {
    const result = await applyProxyToPi();
    expect(result.success).toBe(true);
    expect(result.detail).toContain('http://127.0.0.1:7897');
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7897');
  });

  it('applies nothing when mode is off', async () => {
    settingsApiMock.getAll.mockResolvedValue({ httpProxyMode: 'off' });
    const result = await applyProxyToPi();
    expect(result.success).toBe(true);
    expect(result.detail).toBe('off');
    expect(process.env.HTTPS_PROXY).toBeUndefined();
  });
});
