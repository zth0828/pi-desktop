import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAccess = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: (...args: unknown[]) => mockAccess(...args),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-downloads'),
    quit: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../electron/services/pi-runtime-api', () => ({
  hasStreamingRuntimes: vi.fn().mockReturnValue(false),
}));

vi.mock('../../electron/main/ipc/host-events', () => ({
  sendHostEvent: vi.fn(),
}));

vi.mock('../../electron/utils/host-fetch', () => ({
  hostFetch: vi.fn(),
}));

const electronMock = (await import('electron')) as unknown as {
  shell: {
    openPath: ReturnType<typeof vi.fn>;
  };
};

const settingsApiMock = (await import('../../electron/services/settings-api')).settingsApi as unknown as {
  get: ReturnType<typeof vi.fn>;
};

const piRuntimeApiMock = (await import('../../electron/services/pi-runtime-api')) as unknown as {
  hasStreamingRuntimes: ReturnType<typeof vi.fn>;
};

const { appUpdateApi } = await import('../../electron/services/app-update-api');

describe('appUpdateApi.installDownloaded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails if no downloaded installer exists in settings', async () => {
    settingsApiMock.get.mockResolvedValue(undefined);
    const res = await appUpdateApi.installDownloaded();
    expect(res.success).toBe(false);
    expect(res.error).toBe('No downloaded installer');
  });

  it('rejects unforced install when sessions are running', async () => {
    settingsApiMock.get.mockResolvedValue('/tmp/Pi.Desktop-0.5.0.dmg');
    piRuntimeApiMock.hasStreamingRuntimes.mockReturnValue(true);

    const res = await appUpdateApi.installDownloaded();
    expect(res.success).toBe(false);
    expect(res.error).toBe('RUNNING_SESSIONS');
  });

  it('allows forced install even when sessions are running', async () => {
    settingsApiMock.get.mockResolvedValue('/tmp/Pi.Desktop-0.5.0.dmg');
    piRuntimeApiMock.hasStreamingRuntimes.mockReturnValue(true);
    electronMock.shell.openPath.mockResolvedValue('');

    const res = await appUpdateApi.installDownloaded({ force: true });
    expect(res.success).toBe(true);
    expect(electronMock.shell.openPath).toHaveBeenCalledWith('/tmp/Pi.Desktop-0.5.0.dmg');
  });

  it('returns error if shell.openPath fails', async () => {
    settingsApiMock.get.mockResolvedValue('/tmp/Pi.Desktop-0.5.0.dmg');
    piRuntimeApiMock.hasStreamingRuntimes.mockReturnValue(false);
    electronMock.shell.openPath.mockResolvedValue('Cannot open file');

    const res = await appUpdateApi.installDownloaded();
    expect(res.success).toBe(false);
    expect(res.error).toBe('Cannot open file');
  });

  it('opens installer successfully when path exists', async () => {
    settingsApiMock.get.mockResolvedValue('/tmp/Pi.Desktop-0.5.0.dmg');
    piRuntimeApiMock.hasStreamingRuntimes.mockReturnValue(false);
    electronMock.shell.openPath.mockResolvedValue('');

    const res = await appUpdateApi.installDownloaded();
    expect(res.success).toBe(true);
    expect(electronMock.shell.openPath).toHaveBeenCalledWith('/tmp/Pi.Desktop-0.5.0.dmg');
  });

  it('rejects device paths in installer path', async () => {
    settingsApiMock.get.mockResolvedValue('\\\\.\\nul');
    const res = await appUpdateApi.installDownloaded();
    expect(res.success).toBe(false);
    expect(res.error).toBe('device paths are not allowed');

    const openRes = await appUpdateApi.openDownloaded();
    expect(openRes.success).toBe(false);
    expect(openRes.error).toBe('device paths are not allowed');

    const showRes = await appUpdateApi.showDownloaded();
    expect(showRes.success).toBe(false);
    expect(showRes.error).toBe('device paths are not allowed');
  });

  it('macOS 补丁更新无目标目录写权限时返回 NO_WRITE_PERMISSION 且不退出', async () => {
    const origPlatform = process.platform;
    const origExec = process.execPath;
    const { app, shell } = await import('electron');

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'execPath', { value: '/Applications/Pi Desktop.app/Contents/MacOS/Pi Desktop', configurable: true });
    (app as unknown as { isPackaged: boolean }).isPackaged = true;

    settingsApiMock.get.mockImplementation(async ({ key }: { key: string }) => {
      if (key === 'appVersionCheckDownloadedPath') return '/tmp/patch.zip';
      if (key === 'appVersionCheckStagedPatchPath') return __filename;
      return undefined;
    });

    mockAccess.mockRejectedValue(new Error('EACCES'));

    try {
      const res = await appUpdateApi.installDownloaded();
      expect(res.success).toBe(false);
      expect(res.error).toBe('NO_WRITE_PERMISSION');
      expect(shell.showItemInFolder).toHaveBeenCalledWith(__filename);
      expect(app.quit).not.toHaveBeenCalled();
    } finally {
      mockAccess.mockResolvedValue(undefined);
      (app as unknown as { isPackaged: boolean }).isPackaged = false;
      Object.defineProperty(process, 'execPath', { value: origExec, configurable: true });
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

