import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: {
    getAll: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../electron/services/pi-system-api', () => ({
  piSystemApi: {
    detect: vi.fn().mockResolvedValue({ pi: { version: '0.84.0' } }),
    checkLatest: vi.fn().mockResolvedValue({ latest: '0.84.2', checkedAt: Date.now() }),
  },
}));

vi.mock('../../electron/services/app-api', () => ({
  appApi: {
    version: vi.fn().mockReturnValue('0.4.0'),
  },
}));

vi.mock('../../electron/main/ipc/host-events', () => ({
  sendHostEvent: vi.fn(),
}));

vi.mock('../../electron/utils/host-fetch', () => ({
  hostFetch: vi.fn(),
}));

const settingsApiMock = (await import('../../electron/services/settings-api')).settingsApi as unknown as {
  getAll: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

const hostEventsMock = (await import('../../electron/main/ipc/host-events')) as unknown as {
  sendHostEvent: ReturnType<typeof vi.fn>;
};

const hostFetchMock = (await import('../../electron/utils/host-fetch')) as unknown as {
  hostFetch: ReturnType<typeof vi.fn>;
};

const { versionCheckApi } = await import('../../electron/services/version-check-api');

describe('version-check-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies when a new app version is found and records noticed tag', async () => {
    settingsApiMock.getAll.mockResolvedValue({});
    hostFetchMock.hostFetch.mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.5.0',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/zth0828/pi-desktop/releases/tag/v0.5.0',
      assets: [{ name: 'Pi.Desktop-0.5.0-arm64.dmg' }],
    })));

    const result = await versionCheckApi.check({ force: true });
    expect(result.app.updateAvailable).toBe(true);
    expect(result.app.latest).toBe('v0.5.0');

    expect(hostEventsMock.sendHostEvent).toHaveBeenCalledWith(
      'versionCheck',
      'updateAvailable',
      expect.objectContaining({
        kind: 'app',
        latest: 'v0.5.0',
        releaseUrl: 'https://github.com/zth0828/pi-desktop/releases/tag/v0.5.0',
      }),
    );
    expect(settingsApiMock.set).toHaveBeenCalledWith({
      key: 'appVersionCheckNoticedLatest',
      value: 'v0.5.0',
    });
  });

  it('does not re-notify if the same version was already noticed', async () => {
    settingsApiMock.getAll.mockResolvedValue({
      appVersionCheckNoticedLatest: 'v0.5.0',
      piVersionCheckNoticedLatest: '0.84.2',
    });
    hostFetchMock.hostFetch.mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.5.0',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/zth0828/pi-desktop/releases/tag/v0.5.0',
      assets: [{ name: 'Pi.Desktop-0.5.0-arm64.dmg' }],
    })));

    const result = await versionCheckApi.check({ force: true });
    expect(result.app.updateAvailable).toBe(true);
    expect(hostEventsMock.sendHostEvent).not.toHaveBeenCalledWith(
      'versionCheck',
      'updateAvailable',
      expect.objectContaining({ kind: 'app', latest: 'v0.5.0' }),
    );
  });
});
