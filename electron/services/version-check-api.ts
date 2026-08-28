import { DEFAULT_DOWNLOAD_MIRROR, type VersionCheckSnapshot, type VersionCheckStatus } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { piSystemApi } from './pi-system-api';
import { appApi } from './app-api';
import { compareSemver, parseSemver } from '../utils/semver';
import { hostFetch } from '../utils/host-fetch';
import { sendHostEvent } from '../main/ipc/host-events';

import { selectAssetName } from './app-update-api';

export const VERSION_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const GITHUB_RELEASE_URL = 'https://api.github.com/repos/zth0828/pi-desktop/releases/latest';

let inFlight: Promise<VersionCheckSnapshot> | null = null;
let status: VersionCheckSnapshot = {
  pi: { updateAvailable: false },
  app: { updateAvailable: false },
};

function updateStatus(current: VersionCheckSnapshot): VersionCheckSnapshot {
  status = current;
  return status;
}

function compare(current: string | undefined, latest: string | undefined): boolean {
  if (!current || !latest || !parseSemver(current) || !parseSemver(latest)) return false;
  return compareSemver(current, latest) < 0;
}

/** 检查是否已到期（需发起新一次联网检测） */
function isCheckDue(options: {
  force: boolean;
  lastAttemptAt?: number;
  error?: string;
  latest?: string;
  current?: string;
  now: number;
}): boolean {
  const { force, lastAttemptAt, error, latest, current, now } = options;
  if (force || !lastAttemptAt || Boolean(error)) return true;
  if (now - lastAttemptAt >= VERSION_CHECK_INTERVAL_MS) return true;
  // 存储中的最新版本比当前本地版本还旧或相等（说明缓存陈旧，需联网重新刷新）
  if (Boolean(latest) && !compare(current, latest)) return true;
  return false;
}

/** 检查是否有待向用户提示的新版本通知（且用户尚未点过已读/关闭） */
function isNoticePending(options: {
  current?: string;
  latest?: string;
  noticedLatest?: string;
}): boolean {
  const { current, latest, noticedLatest } = options;
  return Boolean(latest && compare(current, latest) && noticedLatest !== latest);
}

async function checkPi(previous: VersionCheckStatus, now: number): Promise<VersionCheckStatus> {
  const current = (await piSystemApi.detect()).pi.version;
  try {
    const result = await piSystemApi.checkLatest();
    if (!result.latest) {
      const error = 'Unable to check pi version';
      await settingsApi.set({ key: 'piVersionCheckError', value: error });
      return { ...previous, current, lastAttemptAt: now, error };
    }
    await settingsApi.set({ key: 'piVersionCheckLastSuccessAt', value: result.checkedAt });
    await settingsApi.set({ key: 'piVersionCheckLatest', value: result.latest });
    await settingsApi.set({ key: 'piVersionCheckError', value: undefined });
    return { current, latest: result.latest, updateAvailable: compare(current, result.latest), lastAttemptAt: now, lastSuccessAt: result.checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await settingsApi.set({ key: 'piVersionCheckError', value: message });
    return { ...previous, current, lastAttemptAt: now, error: message };
  }
}

async function fetchReleaseMetadata(url: string, mirrorPrefix?: string) {
  const isCustomUrl = Boolean(process.env.PI_DESKTOP_GITHUB_API_URL);
  const tryFetch = async (targetUrl: string) => {
    const response = await hostFetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Pi-Desktop' },
    });
    if (!response.ok) throw new Error(`Release request failed (${response.status})`);
    return (await response.json()) as {
      tag_name?: string;
      draft?: boolean;
      prerelease?: boolean;
      html_url?: string;
      assets?: Array<{ name?: string }>;
    };
  };

  const customMirror = mirrorPrefix?.trim();
  const mirrorUrl = (prefix: string, base: string) => (prefix.endsWith('/') ? `${prefix}${base}` : `${prefix}/${base}`);
  const apiChannels = customMirror
    ? [mirrorUrl(customMirror, url), url, ...(isCustomUrl ? [] : [mirrorUrl(DEFAULT_DOWNLOAD_MIRROR, url)])]
    : (isCustomUrl ? [url] : [url, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR, url)]);

  let lastError: unknown;
  for (const apiUrl of apiChannels) {
    try {
      return await tryFetch(apiUrl);
    } catch (err) {
      lastError = err;
    }
  }

  // 仅在默认官方 GitHub 地址场景下探测 HTML 302 重定向
  if (!isCustomUrl) {
    const htmlUrl = 'https://github.com/zth0828/pi-desktop/releases/latest';
    const htmlChannels = customMirror
      ? [mirrorUrl(customMirror, htmlUrl), htmlUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR, htmlUrl)]
      : [htmlUrl, mirrorUrl(DEFAULT_DOWNLOAD_MIRROR, htmlUrl)];

    for (const redirectUrl of htmlChannels) {
      try {
        const probeRes = await hostFetch(redirectUrl, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          headers: { 'user-agent': 'Pi-Desktop' },
        });
        const location = probeRes.headers.get('location');
        if (location) {
          const match = /\/releases\/tag\/(v?[\d.]+.*)$/.exec(location);
          if (match) {
            const tag = match[1];
            return {
              tag_name: tag,
              draft: false,
              prerelease: false,
              html_url: `https://github.com/zth0828/pi-desktop/releases/tag/${tag}`,
              assets: [],
            };
          }
        }
      } catch {
        // 忽略单个重定向探测错误
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Release request failed'));
}

async function checkApp(previous: VersionCheckStatus & { releaseUrl?: string; assetName?: string }, now: number) {
  const current = appApi.version();
  const url = process.env.PI_DESKTOP_GITHUB_API_URL ?? GITHUB_RELEASE_URL;
  try {
    const mirrorPrefix = (await settingsApi.get({ key: 'downloadMirror' })) as string | undefined;
    const release = await fetchReleaseMetadata(url, mirrorPrefix);
    if (release.draft || release.prerelease || !release.tag_name || !parseSemver(release.tag_name)) throw new Error('No stable release found');
    await settingsApi.set({ key: 'appVersionCheckLastSuccessAt', value: now });
    await settingsApi.set({ key: 'appVersionCheckLatest', value: release.tag_name });
    await settingsApi.set({ key: 'appVersionCheckReleaseUrl', value: release.html_url });
    await settingsApi.set({ key: 'appVersionCheckAssetName', value: selectAssetName(release.assets ?? []) });
    await settingsApi.set({ key: 'appVersionCheckError', value: undefined });
    return { ...previous, current, latest: release.tag_name, updateAvailable: compare(current, release.tag_name), lastAttemptAt: now, lastSuccessAt: now, releaseUrl: release.html_url, error: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await settingsApi.set({ key: 'appVersionCheckError', value: message });
    return { ...previous, current, lastAttemptAt: now, error: message };
  }
}

async function performCheck(force: boolean): Promise<VersionCheckSnapshot> {
  const saved = await settingsApi.getAll();
  const now = Date.now();
  const currentApp = appApi.version();
  const currentPi = (await piSystemApi.detect()).pi.version;
  const piPrevious: VersionCheckStatus = { latest: saved.piVersionCheckLatest, updateAvailable: false, lastAttemptAt: saved.piVersionCheckLastAttemptAt, lastSuccessAt: saved.piVersionCheckLastSuccessAt, error: saved.piVersionCheckError };
  const appPrevious = { latest: saved.appVersionCheckLatest, updateAvailable: false, lastAttemptAt: saved.appVersionCheckLastAttemptAt, lastSuccessAt: saved.appVersionCheckLastSuccessAt, error: saved.appVersionCheckError, releaseUrl: saved.appVersionCheckReleaseUrl, assetName: saved.appVersionCheckAssetName };

  const piDue = isCheckDue({
    force,
    lastAttemptAt: saved.piVersionCheckLastAttemptAt,
    error: saved.piVersionCheckError,
    latest: saved.piVersionCheckLatest,
    current: currentPi,
    now,
  });

  const appDue = isCheckDue({
    force,
    lastAttemptAt: saved.appVersionCheckLastAttemptAt,
    error: saved.appVersionCheckError,
    latest: saved.appVersionCheckLatest,
    current: currentApp,
    now,
  });

  if (!piDue && !appDue) {
    return updateStatus({
      pi: { ...piPrevious, current: currentPi, updateAvailable: compare(currentPi, piPrevious.latest) },
      app: { ...appPrevious, current: currentApp, updateAvailable: compare(currentApp, appPrevious.latest), downloadedPath: saved.appVersionCheckDownloadedPath },
    });
  }

  if (piDue) await settingsApi.set({ key: 'piVersionCheckLastAttemptAt', value: now });
  if (appDue) await settingsApi.set({ key: 'appVersionCheckLastAttemptAt', value: now });

  const appStatusPromise = (appDue ? checkApp(appPrevious, now) : Promise.resolve(appPrevious)).then((appResult) => {
    const current = ('current' in appResult && typeof appResult.current === 'string') ? appResult.current : currentApp;
    if (isNoticePending({ current, latest: appResult.latest, noticedLatest: saved.appVersionCheckNoticedLatest })) {
      sendHostEvent('versionCheck', 'updateAvailable', {
        current,
        latest: appResult.latest!,
        releaseUrl: appResult.releaseUrl,
        kind: 'app',
      });
    }
    return appResult;
  });

  const pi = await (piDue ? checkPi(piPrevious, now) : Promise.resolve(piPrevious));
  const appStatus = await appStatusPromise;

  if (isNoticePending({ current: pi.current, latest: pi.latest, noticedLatest: saved.piVersionCheckNoticedLatest })) {
    sendHostEvent('versionCheck', 'updateAvailable', {
      current: pi.current ?? '',
      latest: pi.latest!,
      kind: 'pi',
    });
  }

  return updateStatus({ pi, app: { ...appStatus, downloadedPath: saved.appVersionCheckDownloadedPath } });
}

export const versionCheckApi = {
  check: (payload?: { force?: boolean }) => {
    if (!inFlight) inFlight = performCheck(Boolean(payload?.force)).finally(() => { inFlight = null; });
    return inFlight;
  },
  getStatus: async () => {
    const saved = await settingsApi.getAll();
    const currentPi = (await piSystemApi.detect()).pi.version;
    return updateStatus({
      pi: { current: currentPi, latest: saved.piVersionCheckLatest, updateAvailable: compare(currentPi, saved.piVersionCheckLatest), lastAttemptAt: saved.piVersionCheckLastAttemptAt, lastSuccessAt: saved.piVersionCheckLastSuccessAt, error: saved.piVersionCheckError },
      app: { current: appApi.version(), latest: saved.appVersionCheckLatest, updateAvailable: compare(appApi.version(), saved.appVersionCheckLatest), lastAttemptAt: saved.appVersionCheckLastAttemptAt, lastSuccessAt: saved.appVersionCheckLastSuccessAt, error: saved.appVersionCheckError, releaseUrl: saved.appVersionCheckReleaseUrl, assetName: saved.appVersionCheckAssetName, downloadedPath: saved.appVersionCheckDownloadedPath },
    });
  },
  getPendingNotice: async () => {
    const saved = await settingsApi.getAll();
    const appCurrent = appApi.version();
    if (isNoticePending({ current: appCurrent, latest: saved.appVersionCheckLatest, noticedLatest: saved.appVersionCheckNoticedLatest })) {
      return {
        current: appCurrent,
        latest: saved.appVersionCheckLatest!,
        releaseUrl: saved.appVersionCheckReleaseUrl,
        kind: 'app' as const,
      };
    }
    const piCurrent = (await piSystemApi.detect()).pi.version;
    if (isNoticePending({ current: piCurrent, latest: saved.piVersionCheckLatest, noticedLatest: saved.piVersionCheckNoticedLatest })) {
      return { current: piCurrent ?? '', latest: saved.piVersionCheckLatest!, kind: 'pi' as const };
    }
    return null;
  },
  dismissNotice: async (payload: { kind: 'app' | 'pi'; latest: string }) => {
    await settingsApi.set({
      key: payload.kind === 'app' ? 'appVersionCheckNoticedLatest' : 'piVersionCheckNoticedLatest',
      value: payload.latest,
    });
    return { success: true };
  },
};

let checkTimer: NodeJS.Timeout | null = null;

export function scheduleVersionChecks(): void {
  void versionCheckApi.check().catch(() => undefined);
  if (!checkTimer) {
    checkTimer = setInterval(() => {
      void versionCheckApi.check().catch(() => undefined);
    }, VERSION_CHECK_INTERVAL_MS);
    checkTimer.unref?.();
  }
}
