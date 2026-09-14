import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { buildMirrorUrl, DEFAULT_DOWNLOAD_MIRROR, type AppUpdateDownloadResult, type HostSuccess } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { sendHostEvent } from '../main/ipc/host-events';
import { hostFetch } from '../utils/host-fetch';
import { hasStreamingRuntimes } from './pi-runtime-api';

const githubUrl = () => process.env.PI_DESKTOP_GITHUB_API_URL ?? 'https://api.github.com/repos/zth0828/pi-desktop/releases/latest';
let inFlight: Promise<AppUpdateDownloadResult> | null = null;

export function platformName(platform = process.platform): string {
  return platform === 'darwin' ? 'macOS' : 'Windows';
}

export function platformAssetArch(platform = process.platform, arch = process.arch): string[] {
  return [arch];
}

export function selectAsset(
  assets: Array<{ name: string; browser_download_url: string }>,
  platform = process.platform,
  arch = process.arch,
  options?: { preferPatch?: boolean },
): { name: string; url: string } | null {
  if (options?.preferPatch !== false) {
    const patchAsset = assets.find((candidate) => candidate.name.endsWith('-patch.zip'));
    if (patchAsset) return { name: patchAsset.name, url: patchAsset.browser_download_url };
  }
  const assetArch = platformAssetArch(platform, arch);
  const candidates = assets.filter((asset) =>
    assetArch.some((suffix) => asset.name.includes(`-${suffix}.`) || asset.name.includes(`-${suffix}-`)),
  );
  if (platform === 'darwin') {
    const zipAsset = candidates.find((candidate) => candidate.name.endsWith('.zip'));
    if (zipAsset) return { name: zipAsset.name, url: zipAsset.browser_download_url };
    const dmgAsset = candidates.find((candidate) => candidate.name.endsWith('.dmg'));
    return dmgAsset ? { name: dmgAsset.name, url: dmgAsset.browser_download_url } : null;
  }
  if (platform === 'win32') {
    const asset = candidates.find((candidate) => candidate.name.includes('-Setup-') && candidate.name.endsWith('.exe'));
    return asset ? { name: asset.name, url: asset.browser_download_url } : null;
  }
  return null;
}

export function selectAssetName(
  assets: Array<{ name?: string }>,
  platform = process.platform,
  arch = process.arch,
  options?: { preferPatch?: boolean },
): string | undefined {
  const validAssets = assets
    .filter((a): a is { name: string } => typeof a.name === 'string' && Boolean(a.name))
    .map((a) => ({ name: a.name, browser_download_url: '' }));
  return selectAsset(validAssets, platform, arch, options)?.name;
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
  onProgress: (downloaded: number, total: number, speed: number) => void,
): Promise<void> {
  const customMirror = mirrorPrefix?.trim();
  const mirrorUrl = (prefix: string) => buildMirrorUrl(prefix, primaryUrl);
  const channels = customMirror
    ? [mirrorUrl(customMirror), primaryUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR)]
    : [primaryUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR)];
  let lastError: unknown;

  for (const channelUrl of channels) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        sendHostEvent('appUpdate', 'progress', {
          phase: 'retrying',
          retryAttempt: attempt + 1,
          maxRetries: 3,
          error: lastError instanceof Error ? lastError.message : String(lastError ?? 'Network error'),
        });
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
            onProgress(existingBytes, existingBytes, 0);
            return;
          }
          throw new Error(`Download failed (${response.status})`);
        }

        const isPartial = response.status === 206;
        const contentLength = Number(response.headers.get('content-length') ?? 0);
        const total = isPartial ? existingBytes + contentLength : (contentLength || existingBytes);
        let downloaded = isPartial ? existingBytes : 0;

        const writer = createWriteStream(destinationPath, { flags: isPartial ? 'a' : 'w' });
        let lastSpeedSampleAt = Date.now();
        let lastSpeedSampleBytes = downloaded;
        let currentSpeed = 0;
        let lastProgressEmitAt = 0;

        onProgress(downloaded, total, 0);

        try {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            writer.write(Buffer.from(chunk));
            downloaded += chunk.byteLength;
            const now = Date.now();
            const elapsed = now - lastSpeedSampleAt;
            if (elapsed >= 500) {
              currentSpeed = Math.round(((downloaded - lastSpeedSampleBytes) / elapsed) * 1000);
              lastSpeedSampleAt = now;
              lastSpeedSampleBytes = downloaded;
            }
            if (now - lastProgressEmitAt >= 250 || downloaded === total) {
              lastProgressEmitAt = now;
              onProgress(downloaded, total, currentSpeed);
            }
          }
          await new Promise<void>((resolve, reject) => {
            writer.end((err?: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
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
  const mirrorUrl = (prefix: string) => buildMirrorUrl(prefix, primaryUrl);
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
  download: (payload?: { silent?: boolean }): Promise<AppUpdateDownloadResult> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let tempPath: string | undefined;
      try {
        const mirrorPrefix = (await settingsApi.get({ key: 'downloadMirror' })) as string | undefined;
        const isCustomUrl = Boolean(process.env.PI_DESKTOP_GITHUB_API_URL);
        const customMirror = mirrorPrefix?.trim();
        const releaseUrl = (prefix: string) => buildMirrorUrl(prefix, githubUrl());
        const releaseChannels = customMirror
          ? [releaseUrl(customMirror), githubUrl(), ...(isCustomUrl ? [] : [releaseUrl(DEFAULT_DOWNLOAD_MIRROR)])]
          : (isCustomUrl ? [githubUrl()] : [githubUrl(), releaseUrl(DEFAULT_DOWNLOAD_MIRROR)]);
        let release: { tag_name?: string; body?: string; assets?: Array<{ name: string; browser_download_url: string }> } | undefined;
        let lastReleaseError: unknown;

        for (const rUrl of releaseChannels) {
          try {
            const res = await hostFetch(rUrl, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'Pi-Desktop' } });
            if (res.ok) {
              release = (await res.json()) as { tag_name?: string; body?: string; assets?: Array<{ name: string; browser_download_url: string }> };
              break;
            }
          } catch (err) {
            lastReleaseError = err;
          }
        }
        if (!release) throw lastReleaseError instanceof Error ? lastReleaseError : new Error(String(lastReleaseError ?? 'Release metadata fetch failed'));

        const asset = selectAsset(release.assets ?? []);
        if (!asset) throw new Error(`No supported ${platformName()} update asset found`);
        const sumsName = `SHA256SUMS-${platformName()}.txt`;
        const sums = (release.assets ?? []).find((candidate) => candidate.name === sumsName);
        const downloadsDir = app.getPath('downloads');
        await mkdir(downloadsDir, { recursive: true });
        tempPath = path.join(downloadsDir, `${asset.name}.part`);

        sendHostEvent('appUpdate', 'progress', { phase: 'started' });
        await downloadToFile(asset.url, mirrorPrefix, tempPath, (downloaded, total, speed) => {
          sendHostEvent('appUpdate', 'progress', {
            phase: 'progress',
            downloadedBytes: downloaded,
            totalBytes: total,
            speedBytesPerSec: speed,
          });
        });

        if (sums) {
          try {
            const checksumText = await fetchChecksumText(sums.browser_download_url, mirrorPrefix);
            const expected = checksumText.split(/\r?\n/).find((line) => line.endsWith(`  ${asset.name}`))?.split(/\s+/)[0];
            if (expected) {
              const hash = createHash('sha256');
              for await (const chunk of createReadStream(tempPath)) hash.update(chunk);
              if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) {
                await rm(tempPath, { force: true }).catch(() => undefined);
                throw new Error('Checksum mismatch');
              }
            }
          } catch (checksumErr) {
            if (checksumErr instanceof Error && checksumErr.message === 'Checksum mismatch') {
              throw checksumErr;
            }
            console.warn('[appUpdateApi] Checksum verification skipped or unavailable, proceeding with download:', checksumErr);
          }
        }
        const finalPath = path.join(downloadsDir, asset.name);
        await rm(finalPath, { force: true }).catch(() => undefined);
        await rename(tempPath, finalPath);
        tempPath = undefined;

        let stagedAppPath: string | undefined;
        let stagedPatchPath: string | undefined;

        if (finalPath.endsWith('-patch.zip')) {
          try {
            const stagedPatchDir = path.join(app.getPath('userData'), 'updates', 'staged-patch');
            await rm(stagedPatchDir, { recursive: true, force: true }).catch(() => undefined);
            await mkdir(stagedPatchDir, { recursive: true });
            const zipBuffer = await readFile(finalPath);
            const unzipped = unzipSync(new Uint8Array(zipBuffer));
            if (unzipped['app.asar']) {
              const asarBytes = unzipped['app.asar'];
              if (unzipped['patch-metadata.json']) {
                const metaText = new TextDecoder().decode(unzipped['patch-metadata.json']);
                const meta = JSON.parse(metaText) as { sha256?: string };
                if (meta.sha256) {
                  const actualHash = createHash('sha256').update(asarBytes).digest('hex');
                  if (actualHash.toLowerCase() !== meta.sha256.toLowerCase()) {
                    throw new Error('Patch asar checksum mismatch');
                  }
                }
              }
              const targetAsar = path.join(stagedPatchDir, 'app.asar');
              await writeFile(targetAsar, asarBytes);
              stagedPatchPath = targetAsar;
              await settingsApi.set({ key: 'appVersionCheckStagedPatchPath', value: stagedPatchPath });
              await settingsApi.set({ key: 'appVersionCheckStagedAppPath', value: undefined });
            } else {
              throw new Error('Patch zip does not contain app.asar');
            }
          } catch (extractErr) {
            console.warn('[appUpdateApi] Failed to stage patch bundle:', extractErr);
          }
        } else if (process.platform === 'darwin' && finalPath.endsWith('.zip')) {
          try {
            const stagedDir = path.join(app.getPath('userData'), 'updates', 'staged');
            await rm(stagedDir, { recursive: true, force: true }).catch(() => undefined);
            await mkdir(stagedDir, { recursive: true });
            await new Promise<void>((resolve, reject) => {
              const child = spawn('/usr/bin/ditto', ['-xk', finalPath, stagedDir], { stdio: 'ignore' });
              child.on('error', reject);
              child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Failed to extract update package (exit code ${code})`));
              });
            });
            const entries = await readdir(stagedDir);
            const appEntry = entries.find((e) => e.endsWith('.app'));
            if (appEntry) {
              stagedAppPath = path.join(stagedDir, appEntry);
              await settingsApi.set({ key: 'appVersionCheckStagedAppPath', value: stagedAppPath });
              await settingsApi.set({ key: 'appVersionCheckStagedPatchPath', value: undefined });
            }
          } catch (extractErr) {
            console.warn('[appUpdateApi] Failed to stage .zip bundle:', extractErr);
          }
        }

        await settingsApi.set({ key: 'appVersionCheckDownloadedPath', value: finalPath });
        const version = release.tag_name?.replace(/^v/, '');
        const isSilent = payload?.silent === true;
        const releaseNotes = release.body;
        sendHostEvent('appUpdate', 'progress', { phase: 'completed', path: finalPath, stagedAppPath, stagedPatchPath, version, releaseNotes, silent: isSilent });
        sendHostEvent('appUpdate', 'progress', { phase: 'ready', path: finalPath, stagedAppPath, stagedPatchPath, version, releaseNotes, silent: isSilent });
        return { success: true, path: finalPath, assetName: asset.name, stagedAppPath, stagedPatchPath };
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
    if (pathName.endsWith('-patch.zip')) {
      shell.showItemInFolder(pathName);
      return { success: true };
    }
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

    if (process.env.PI_DESKTOP_E2E === '1') {
      return { success: true };
    }

    const stagedPatchPath = await settingsApi.get({ key: 'appVersionCheckStagedPatchPath' });
    if (stagedPatchPath && typeof stagedPatchPath === 'string' && existsSync(stagedPatchPath)) {
      const stagedPatchDir = path.dirname(stagedPatchPath);

      if (process.platform === 'darwin') {
        const currentExec = process.execPath;
        const targetAppPath = path.resolve(currentExec, '../../..');
        const isDev = !app.isPackaged || targetAppPath.includes('.dev') || targetAppPath.includes('node_modules') || !targetAppPath.endsWith('.app');

        if (isDev) {
          shell.showItemInFolder(stagedPatchPath);
          return { success: true };
        }

        const targetAsarPath = path.join(process.resourcesPath, 'app.asar');
        const script = [
          'OLD_PID="$1"',
          'SRC_ASAR="$2"',
          'DEST_ASAR="$3"',
          'DEST_APP="$4"',
          'STAGED_DIR="$5"',
          'while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.05; done',
          'cp -f "$SRC_ASAR" "$DEST_ASAR"',
          'xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true',
          'codesign --force --deep --sign - "$DEST_APP" 2>/dev/null || true',
          'rm -rf "$STAGED_DIR"',
          'open -n "$DEST_APP"',
        ].join('\n');

        const child = spawn('/bin/sh', ['-c', script, '--', String(process.pid), stagedPatchPath, targetAsarPath, targetAppPath, stagedPatchDir], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        setTimeout(() => {
          app.quit();
        }, 100);
        return { success: true };
      }

      if (process.platform === 'win32') {
        const isDev = !app.isPackaged;
        if (isDev) {
          shell.showItemInFolder(stagedPatchPath);
          return { success: true };
        }

        const targetAsarPath = path.join(process.resourcesPath, 'app.asar');
        const batPath = path.join(app.getPath('temp'), `pi-desktop-patch-${Date.now()}.bat`);
        const batContent = [
          '@echo off',
          'chcp 65001 >nul',
          'set /a count=0',
          ':retry',
          'timeout /t 1 /nobreak >nul',
          `copy /y "${stagedPatchPath}" "${targetAsarPath}" >nul 2>&1`,
          'if errorlevel 1 (',
          '  set /a count+=1',
          '  if %count% lss 15 goto retry',
          '  exit /b 1',
          ')',
          `rmdir /s /q "${stagedPatchDir}" >nul 2>&1`,
          `start "" "${process.execPath}"`,
          `del "%~f0" >nul 2>&1`,
        ].join('\r\n');

        await writeFile(batPath, batContent, 'utf8');
        const child = spawn('cmd.exe', ['/c', batPath], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        setTimeout(() => {
          app.quit();
        }, 100);
        return { success: true };
      }
    }

    if (pathName.endsWith('-patch.zip')) {
      return { success: false, error: 'Patch update staging missing or corrupted' };
    }

    if (process.platform === 'darwin') {
      const stagedAppPath = await settingsApi.get({ key: 'appVersionCheckStagedAppPath' });
      if (stagedAppPath && typeof stagedAppPath === 'string' && existsSync(stagedAppPath)) {
        const currentExec = process.execPath;
        const targetAppPath = path.resolve(currentExec, '../../..');
        const isDev = !app.isPackaged || targetAppPath.includes('.dev') || targetAppPath.includes('node_modules') || !targetAppPath.endsWith('.app');

        if (!isDev && existsSync(targetAppPath)) {
          const script = [
            'OLD_PID="$1"',
            'SRC_APP="$2"',
            'DEST_APP="$3"',
            'while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.05; done',
            'rm -rf "$DEST_APP"',
            '/usr/bin/ditto "$SRC_APP" "$DEST_APP"',
            'xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true',
            'rm -rf "$(dirname "$SRC_APP")"',
            'open -n "$DEST_APP"',
          ].join('\n');

          const child = spawn('/bin/sh', ['-c', script, '--', String(process.pid), stagedAppPath, targetAppPath], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();

          setTimeout(() => {
            app.quit();
          }, 100);
          return { success: true };
        }
      }

      const error = await shell.openPath(pathName);
      if (error) return { success: false, error };
      setTimeout(() => {
        app.quit();
      }, 500);
      return { success: true };
    }

    if (process.platform === 'win32') {
      if (pathName.endsWith('.exe')) {
        const cmd = `timeout /t 1 /nobreak >nul & "${pathName}" /S & start "" "${process.execPath}"`;
        const child = spawn('cmd.exe', ['/c', cmd], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        setTimeout(() => {
          app.quit();
        }, 100);
        return { success: true };
      }
      const error = await shell.openPath(pathName);
      if (error) return { success: false, error };
      setTimeout(() => {
        app.quit();
      }, 500);
      return { success: true };
    }

    return { success: true };
  },
};
