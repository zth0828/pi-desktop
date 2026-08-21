import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { platformAssetArch, platformName } from '../../electron/services/app-update-api';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-downloads'),
    quit: vi.fn(),
  },
  shell: {
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../electron/main/ipc/host-events', () => ({
  sendHostEvent: vi.fn(),
}));

vi.mock('../../electron/utils/host-fetch', () => ({
  hostFetch: vi.fn(),
}));

const settingsApiMock = (await import('../../electron/services/settings-api')).settingsApi as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

const hostFetchMock = (await import('../../electron/utils/host-fetch')) as unknown as {
  hostFetch: ReturnType<typeof vi.fn>;
};

const { appUpdateApi } = await import('../../electron/services/app-update-api');

describe('app-update-api mirror fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to mirror when direct download fails', async () => {
    const arch = platformAssetArch()[0];
    const plat = process.platform;
    const assetName = plat === 'darwin'
      ? `Pi.Desktop-0.5.0-${arch}.dmg`
      : plat === 'win32'
        ? `Pi.Desktop-Setup-0.5.0-${arch}.exe`
        : `Pi.Desktop-0.5.0-${arch}.AppImage`;

    const dummyFileContent = Buffer.from('test-binary-content-12345');
    const sha256 = createHash('sha256').update(dummyFileContent).digest('hex');
    const sumsName = `SHA256SUMS-${platformName()}.txt`;

    settingsApiMock.get.mockImplementation(async ({ key }: { key: string }) => {
      if (key === 'downloadMirror') return 'https://mirror.example.com/';
      return undefined;
    });

    const releaseMeta = {
      assets: [
        { name: assetName, browser_download_url: `https://github.com/release/${assetName}` },
        { name: sumsName, browser_download_url: `https://github.com/release/${sumsName}` },
      ],
    };

    hostFetchMock.hostFetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response(JSON.stringify(releaseMeta));
      }
      // Direct asset URL fails
      if (url === `https://github.com/release/${assetName}`) {
        return new Response('Internal error', { status: 500 });
      }
      // Mirror asset URL succeeds
      if (url === `https://mirror.example.com/https://github.com/release/${assetName}`) {
        return new Response(dummyFileContent, {
          status: 200,
          headers: { 'content-length': String(dummyFileContent.length) },
        });
      }
      // Direct checksum URL fails
      if (url === `https://github.com/release/${sumsName}`) {
        return new Response('Not found', { status: 404 });
      }
      // Mirror checksum URL succeeds
      if (url === `https://mirror.example.com/https://github.com/release/${sumsName}`) {
        return new Response(`${sha256}  ${assetName}\n`, { status: 200 });
      }
      throw new Error(`Unhandled URL: ${url}`);
    });

    const result = await appUpdateApi.download();
    expect(result.success).toBe(true);
    expect(result.assetName).toBe(assetName);
  });
});
