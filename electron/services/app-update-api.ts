import { app, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { AppUpdateDownloadResult } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { sendHostEvent } from '../main/ipc/host-events';

const githubUrl = () => process.env.PI_DESKTOP_GITHUB_API_URL ?? 'https://api.github.com/repos/zth0828/pi-desktop/releases/latest';
let inFlight: Promise<AppUpdateDownloadResult> | null = null;

export function platformName(platform = process.platform): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
}

export function platformAssetArch(platform = process.platform, arch = process.arch): string[] {
  if (platform === 'linux' && arch === 'x64') return ['x86_64', 'amd64'];
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

export const appUpdateApi = {
  download: (): Promise<AppUpdateDownloadResult> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let tempPath: string | undefined;
      try {
        const releaseResponse = await fetch(githubUrl(), { signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'Pi-Desktop' } });
        const release = await releaseResponse.json() as { assets?: Array<{ name: string; browser_download_url: string }> };
        const asset = selectAsset(release.assets ?? []);
        if (!asset) throw new Error(`No supported ${platformName()} update asset found`);
        const sumsName = `SHA256SUMS-${platformName()}.txt`;
        const sums = (release.assets ?? []).find((candidate) => candidate.name === sumsName);
        if (!sums) throw new Error(`Missing ${sumsName}`);
        const downloadsDir = app.getPath('downloads');
        await mkdir(downloadsDir, { recursive: true });
        tempPath = path.join(downloadsDir, `.${asset.name}.part`);
        const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
        const total = Number(response.headers.get('content-length') ?? 0);
        let downloaded = 0;
        const writer = createWriteStream(tempPath);
        sendHostEvent('appUpdate', 'progress', { phase: 'started', totalBytes: total });
        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
          writer.write(Buffer.from(chunk)); downloaded += chunk.byteLength;
          sendHostEvent('appUpdate', 'progress', { phase: 'progress', downloadedBytes: downloaded, totalBytes: total });
        }
        await new Promise<void>((resolve, reject) => { writer.end(() => resolve()); writer.on('error', reject); });
        const checksumResponse = await fetch(sums.browser_download_url, { signal: AbortSignal.timeout(10000) });
        if (!checksumResponse.ok) throw new Error(`Checksum download failed (${checksumResponse.status})`);
        const checksumText = await checksumResponse.text();
        const expected = checksumText.split(/\r?\n/).find((line) => line.endsWith(`  ${asset.name}`))?.split(/\s+/)[0];
        if (!expected) throw new Error(`Checksum for ${asset.name} not found`);
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(tempPath)) hash.update(chunk);
        if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) throw new Error('Checksum mismatch');
        const finalPath = path.join(downloadsDir, asset.name);
        await rm(finalPath, { force: true }); await rename(tempPath, finalPath); tempPath = undefined;
        await settingsApi.set({ key: 'appVersionCheckDownloadedPath', value: finalPath });
        sendHostEvent('appUpdate', 'progress', { phase: 'completed', path: finalPath });
        return { success: true, path: finalPath, assetName: asset.name };
      } catch (error) {
        if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        sendHostEvent('appUpdate', 'progress', { phase: 'failed', error: message });
        return { success: false, error: message };
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  },
  openDownloaded: async () => {
    const pathName = await settingsApi.get({ key: 'appVersionCheckDownloadedPath' });
    if (!pathName) return { success: false, error: 'No downloaded installer' };
    const error = await shell.openPath(pathName);
    return error ? { success: false, error } : { success: true };
  },
  showDownloaded: async () => {
    const pathName = await settingsApi.get({ key: 'appVersionCheckDownloadedPath' });
    if (!pathName) return { success: false, error: 'No downloaded installer' };
    shell.showItemInFolder(pathName);
    return { success: true };
  },
};
