import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockData: Record<string, unknown> = {};

vi.mock('../../electron/utils/electron-store', () => ({
  getElectronStore: vi.fn(async () => ({
    get: (key: string) => mockData[key],
    set: (key: string, value: unknown) => {
      mockData[key] = value;
    },
    delete: (key: string) => {
      delete mockData[key];
    },
  })),
}));

vi.mock('../../electron/main/menu', () => ({
  rebuildNativeMacMenu: vi.fn(async () => {}),
}));

vi.mock('../../electron/main/tray', () => ({
  rebuildTrayMenu: vi.fn(async () => {}),
}));

const { settingsApi } = await import('../../electron/services/settings-api');

describe('settingsApi', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockData)) {
      delete mockData[key];
    }
  });

  it('getAll 返回全部配置快照，包括 appVersionCheckStagedPatchPath', async () => {
    mockData.language = 'zh';
    mockData.appVersionCheckStagedPatchPath = '/path/to/staged-patch.asar';

    const all = await settingsApi.getAll();
    expect(all.language).toBe('zh');
    expect(all.appVersionCheckStagedPatchPath).toBe('/path/to/staged-patch.asar');
  });

  it('set 正确拦截非法类型或 Windows 设备路径的 workspaceCwd', async () => {
    const nonString = await settingsApi.set({ key: 'workspaceCwd', value: 123 as unknown as string });
    expect(nonString).toEqual({ success: false, error: 'invalid-workspace-path' });

    const devicePath = await settingsApi.set({ key: 'workspaceCwd', value: '\\\\.\\COM1' });
    expect(devicePath).toEqual({ success: false, error: 'device paths are not allowed' });
  });

  it('set 写入正常配置并在 value 为 undefined 时删除', async () => {
    const res = await settingsApi.set({ key: 'theme', value: 'dark' });
    expect(res).toEqual({ success: true });
    expect(mockData.theme).toBe('dark');

    await settingsApi.set({ key: 'theme', value: undefined });
    expect(mockData.theme).toBeUndefined();
  });
});
