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

function platformName(): string {
  return process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
}
function selectAsset(assets: Array<{ name: string; browser_download_url: string }>): { name: string; url: string } | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  const candidates = assets.filter((asset) => asset.name.includes(`-${arch}.`));
  if (process.platform === 'darwin') return candidates.find((a) => a.name.endsWith('.dmg')) ? { name: candidates.find((a) => a.name.endsWith('.dmg'))!.name, url: candidates.find((a) => a.name.endsWith('.dmg'))!.browser_download_url } : null;
  if (process.platform === 'win32') return candidates.find((a) => a.name.includes('-Setup-') && a.name.endsWith('.exe')) ? { name: candidates.find((a) => a.name.includes('-Setup-') && a.name.endsWith('.exe'))!.name, url: candidates.find((a) => a.name.includes('-Setup-') && a.name.endsWith('.exe'))!.browser_download_url } : null;
  return candidates.find((a) => a.name.endsWith('.AppImage')) ? { name: candidates.find((a) => a.name.endsWith('.AppImage'))!.name, url: candidates.find((a) => a.name.endsWith('.AppImage'))!.browser_download_url } : candidates.find((a) => a.name.endsWith('.deb')) ? { name: candidates.find((a) => a.name.endsWith('.deb'))!.name, url: candidates.find((a) => a.name.endsWith('.deb'))!.browser_download_url } : null;
}

export const appUpdateApi = {
  download: (): Promise<AppUpdateDownloadResult> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let tempPath: string | undefined;
      try {
        const releaseResponse = await fetch(githubUrl(), { signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.github+json' } });
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
        const checksumText = await (await fetch(sums.browser_download_url)).text();
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
