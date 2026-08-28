import { app, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_DOWNLOAD_MIRROR, type AppUpdateDownloadResult, type HostSuccess } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { sendHostEvent } from '../main/ipc/host-events';
import { hostFetch } from '../utils/host-fetch';
import { hasStreamingRuntimes } from './pi-runtime-api';

const githubUrl = () => process.env.PI_DESKTOP_GITHUB_API_URL ?? 'https://api.github.com/repos/zth0828/pi-desktop/releases/latest';
let inFlight: Promise<AppUpdateDownloadResult> | null = null;

export function platformName(platform = process.platform): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
}

export function platformAssetArch(platform = process.platform, arch = process.arch): string[] {
  if (platform === 'linux') {
    if (arch === 'x64') return ['x64', 'x86_64', 'amd64'];
    if (arch === 'arm64') return ['arm64', 'aarch64'];
  }
  return [arch];
}

export function selectAsset(
  assets: Array<{ name: string; browser_download_url: string }>,
  platform = process.platform,
  arch = process.arch,
): { name: string; url: string } | null {
  const assetArch = platformAssetArch(platform, arch);
  const candidates = assets.filter((asset) => assetArch.some((suffix) => asset.name.includes(`-${suffix}.`)));
  if (platform === 'darwin') {
    const asset = candidates.find((candidate) => candidate.name.endsWith('.dmg'));
    return asset ? { name: asset.name, url: asset.browser_download_url } : null;
  }
  if (platform === 'win32') {
    const asset = candidates.find((candidate) => candidate.name.includes('-Setup-') && candidate.name.endsWith('.exe'));
    return asset ? { name: asset.name, url: asset.browser_download_url } : null;
  }
  const asset = candidates.find((candidate) => candidate.name.endsWith('.AppImage'))
    ?? candidates.find((candidate) => candidate.name.endsWith('.deb'));
  return asset ? { name: asset.name, url: asset.browser_download_url } : null;
}

export function selectAssetName(
  assets: Array<{ name?: string }>,
  platform = process.platform,
  arch = process.arch,
): string | undefined {
  const validAssets = assets
    .filter((a): a is { name: string } => typeof a.name === 'string' && Boolean(a.name))
    .map((a) => ({ name: a.name, browser_download_url: '' }));
  return selectAsset(validAssets, platform, arch)?.name;
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

async function downloadToFile(
  primaryUrl: string,
  mirrorPrefix: string | undefined,
  destinationPath: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  const customMirror = mirrorPrefix?.trim();
  const mirrorUrl = (prefix: string) => (prefix.endsWith('/') ? `${prefix}${primaryUrl}` : `${prefix}/${primaryUrl}`);
  const channels = customMirror
    ? [mirrorUrl(customMirror), primaryUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR)]
    : [primaryUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR)];
  let lastError: unknown;

  for (const channelUrl of channels) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      try {
        const existingBytes = await getFileSize(destinationPath);
        const headers: Record<string, string> = { 'user-agent': 'Pi-Desktop' };
        if (existingBytes > 0) {
          headers['Range'] = `bytes=${existingBytes}-`;
        }

        const response = await hostFetch(channelUrl, {
          headers,
          signal: AbortSignal.timeout(120000),
        });

        if (!response.ok || !response.body) {
          if (response.status === 416 && existingBytes > 0) {
            onProgress(existingBytes, existingBytes);
            return;
          }
          throw new Error(`Download failed (${response.status})`);
        }

        const isPartial = response.status === 206;
        const contentLength = Number(response.headers.get('content-length') ?? 0);
        const total = isPartial ? existingBytes + contentLength : (contentLength || existingBytes);
        let downloaded = isPartial ? existingBytes : 0;

        const writer = createWriteStream(destinationPath, { flags: isPartial ? 'a' : 'w' });
        onProgress(downloaded, total);

        try {
          for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
            writer.write(Buffer.from(chunk));
            downloaded += chunk.byteLength;
            onProgress(downloaded, total);
          }
          await new Promise<void>((resolve, reject) => {
            writer.end(() => resolve());
            writer.on('error', reject);
          });
          return;
        } catch (streamError) {
          writer.destroy();
          // 网络断开不删除已下载的部分文件，保留断点用于重试或跨通道接替
          throw streamError;
        }
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Download failed'));
}

async function fetchChecksumText(
  primaryUrl: string,
  mirrorPrefix: string | undefined,
): Promise<string> {
  const customMirror = mirrorPrefix?.trim();
  const mirrorUrl = (prefix: string) => (prefix.endsWith('/') ? `${prefix}${primaryUrl}` : `${prefix}/${primaryUrl}`);
  const channels = customMirror
    ? [mirrorUrl(customMirror), primaryUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR)]
    : [primaryUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR)];
  let lastError: unknown;

  for (const url of channels) {
    try {
      const res = await hostFetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Checksum download failed'));
}

export const appUpdateApi = {
  download: (): Promise<AppUpdateDownloadResult> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let tempPath: string | undefined;
      try {
        const mirrorPrefix = (await settingsApi.get({ key: 'downloadMirror' })) as string | undefined;
        const isCustomUrl = Boolean(process.env.PI_DESKTOP_GITHUB_API_URL);
        const customMirror = mirrorPrefix?.trim();
        const releaseUrl = (prefix: string) => (prefix.endsWith('/') ? `${prefix}${githubUrl()}` : `${prefix}/${githubUrl()}`);
        const releaseChannels = customMirror
          ? [releaseUrl(customMirror), githubUrl(), ...(isCustomUrl ? [] : [releaseUrl(DEFAULT_DOWNLOAD_MIRROR)])]
          : (isCustomUrl ? [githubUrl()] : [githubUrl(), releaseUrl(DEFAULT_DOWNLOAD_MIRROR)]);
        let release: { assets?: Array<{ name: string; browser_download_url: string }> } | undefined;
        let lastReleaseError: unknown;

        for (const rUrl of releaseChannels) {
          try {
            const res = await hostFetch(rUrl, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'Pi-Desktop' } });
            if (res.ok) {
              release = (await res.json()) as { assets?: Array<{ name: string; browser_download_url: string }> };
              break;
            }
          } catch (err) {
            lastReleaseError = err;
          }
        }
        if (!release) throw lastReleaseError instanceof Error ? lastReleaseError : new Error('Release request failed');

        const asset = selectAsset(release.assets ?? []);
        if (!asset) throw new Error(`No supported ${platformName()} update asset found`);
        const sumsName = `SHA256SUMS-${platformName()}.txt`;
        const sums = (release.assets ?? []).find((candidate) => candidate.name === sumsName);
        if (!sums) throw new Error(`Missing ${sumsName}`);
        const downloadsDir = app.getPath('downloads');
        await mkdir(downloadsDir, { recursive: true });
        tempPath = path.join(downloadsDir, `${asset.name}.part`);

        sendHostEvent('appUpdate', 'progress', { phase: 'started' });
        await downloadToFile(asset.url, mirrorPrefix, tempPath, (downloaded, total) => {
          sendHostEvent('appUpdate', 'progress', { phase: 'progress', downloadedBytes: downloaded, totalBytes: total });
        });

        const checksumText = await fetchChecksumText(sums.browser_download_url, mirrorPrefix);
        const expected = checksumText.split(/\r?\n/).find((line) => line.endsWith(`  ${asset.name}`))?.split(/\s+/)[0];
        if (!expected) throw new Error(`Checksum for ${asset.name} not found`);
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(tempPath)) hash.update(chunk);
        if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) {
          await rm(tempPath, { force: true }).catch(() => undefined);
          throw new Error('Checksum mismatch');
        }
        const finalPath = path.join(downloadsDir, asset.name);
        await rm(finalPath, { force: true }).catch(() => undefined);
        await rename(tempPath, finalPath);
        tempPath = undefined;
        await settingsApi.set({ key: 'appVersionCheckDownloadedPath', value: finalPath });
        sendHostEvent('appUpdate', 'progress', { phase: 'completed', path: finalPath });
        return { success: true, path: finalPath, assetName: asset.name };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendHostEvent('appUpdate', 'progress', { phase: 'failed', error: message });
        return { success: false, error: message };
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  },
  openDownloaded: async () => {
    const pathName = await settingsApi.get({ key: 'appVersionCheckDownloadedPath' });
    if (!pathName || typeof pathName !== 'string') return { success: false, error: 'No downloaded installer' };
    const error = await shell.openPath(pathName);
    return error ? { success: false, error } : { success: true };
  },
  showDownloaded: async () => {
    const pathName = await settingsApi.get({ key: 'appVersionCheckDownloadedPath' });
    if (!pathName || typeof pathName !== 'string') return { success: false, error: 'No downloaded installer' };
    shell.showItemInFolder(pathName);
    return { success: true };
  },
  installDownloaded: async (payload?: { force?: boolean }): Promise<HostSuccess> => {
    const pathName = await settingsApi.get({ key: 'appVersionCheckDownloadedPath' });
    if (!pathName || typeof pathName !== 'string') return { success: false, error: 'No downloaded installer' };
    if (!payload?.force && hasStreamingRuntimes()) {
      return { success: false, error: 'RUNNING_SESSIONS' };
    }
    const error = await shell.openPath(pathName);
    if (error) return { success: false, error };
    if (process.platform !== 'linux') {
      if (process.env.PI_DESKTOP_E2E !== '1' && process.env.NODE_ENV !== 'test') {
        setTimeout(() => {
          app.quit();
        }, 500);
      }
    }
    return { success: true };
  },
};
