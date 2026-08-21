import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
