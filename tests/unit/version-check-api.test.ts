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

  it('notifies when a new app version is found without marking noticed at send time', async () => {
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
    // 发送不标记已读：推送可能先于渲染层订阅丢失，已读只在交付（拉取/关闭）时写
    expect(settingsApiMock.set).not.toHaveBeenCalledWith({
      key: 'appVersionCheckNoticedLatest',
      value: 'v0.5.0',
    });
  });

  it('delivers pending notice on pull without marking noticed', async () => {
    settingsApiMock.getAll.mockResolvedValue({
      appVersionCheckLatest: 'v0.5.0',
      appVersionCheckReleaseUrl: 'https://github.com/zth0828/pi-desktop/releases/tag/v0.5.0',
    });

    const notice = await versionCheckApi.getPendingNotice();
    expect(notice).toMatchObject({ kind: 'app', latest: 'v0.5.0', current: '0.4.0' });
    // 拉取不写已读（挂载竞争会丢弃首次拉取结果）；已读只由 dismissNotice 写
    expect(settingsApiMock.set).not.toHaveBeenCalledWith({
      key: 'appVersionCheckNoticedLatest',
      value: 'v0.5.0',
    });

    // 已读（用户关闭过）后不再补弹
    settingsApiMock.getAll.mockResolvedValue({
      appVersionCheckLatest: 'v0.5.0',
      appVersionCheckNoticedLatest: 'v0.5.0',
      piVersionCheckNoticedLatest: '0.84.2',
    });
    expect(await versionCheckApi.getPendingNotice()).toBeNull();
  });

  it('dismissNotice records the noticed tag for restart persistence', async () => {
    await versionCheckApi.dismissNotice({ kind: 'app', latest: 'v0.5.0' });
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

  it('falls back to mirror and HTML redirect probe when direct GitHub API fails', async () => {
    settingsApiMock.getAll.mockResolvedValue({});
    settingsApiMock.get.mockImplementation(async ({ key }: { key: string }) => {
      if (key === 'downloadMirror') return 'https://mirror.example.com/';
      return undefined;
    });

    hostFetchMock.hostFetch.mockImplementation(async (url: string) => {
      if (url === 'https://api.github.com/repos/zth0828/pi-desktop/releases/latest') {
        throw new Error('connect ETIMEDOUT');
      }
      if (url.includes('mirror.example.com/https://api.github.com')) {
        return new Response(JSON.stringify({
          tag_name: 'v1.1.0',
          draft: false,
          prerelease: false,
          html_url: 'https://github.com/zth0828/pi-desktop/releases/tag/v1.1.0',
          assets: [{ name: 'Pi.Desktop-1.1.0-arm64.dmg' }],
        }));
      }
      throw new Error(`Unhandled URL: ${url}`);
    });

    const result = await versionCheckApi.check({ force: true });
    expect(result.app.updateAvailable).toBe(true);
    expect(result.app.latest).toBe('v1.1.0');
  });
});
