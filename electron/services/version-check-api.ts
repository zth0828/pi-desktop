import type { VersionCheckSnapshot, VersionCheckStatus } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { piSystemApi } from './pi-system-api';
import { appApi } from './app-api';
import { compareSemver, parseSemver } from '../utils/semver';
import { hostFetch } from '../utils/host-fetch';
import { sendHostEvent } from '../main/ipc/host-events';

import { selectAssetName } from './app-update-api';

export const VERSION_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
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

  try {
    return await tryFetch(url);
  } catch (directError) {
    const mirror = mirrorPrefix?.trim();
    if (mirror) {
      const mirrorUrl = mirror.endsWith('/') ? `${mirror}${url}` : `${mirror}/${url}`;
      try {
        return await tryFetch(mirrorUrl);
      } catch {
        // 忽略并继续尝试 HTML 探测
      }
    }

    try {
      const htmlUrl = 'https://github.com/zth0828/pi-desktop/releases/latest';
      const redirectUrl = mirror
        ? (mirror.endsWith('/') ? `${mirror}${htmlUrl}` : `${mirror}/${htmlUrl}`)
        : htmlUrl;
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
      // 忽略
    }

    throw directError;
  }
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
  const piPrevious: VersionCheckStatus = { latest: saved.piVersionCheckLatest, updateAvailable: false, lastAttemptAt: saved.piVersionCheckLastAttemptAt, lastSuccessAt: saved.piVersionCheckLastSuccessAt, error: saved.piVersionCheckError };
  const appPrevious = { latest: saved.appVersionCheckLatest, updateAvailable: false, lastAttemptAt: saved.appVersionCheckLastAttemptAt, lastSuccessAt: saved.appVersionCheckLastSuccessAt, error: saved.appVersionCheckError, releaseUrl: saved.appVersionCheckReleaseUrl, assetName: saved.appVersionCheckAssetName };
  const piDue = force || !saved.piVersionCheckLastAttemptAt || Boolean(saved.piVersionCheckError) || now - saved.piVersionCheckLastAttemptAt >= VERSION_CHECK_INTERVAL_MS;
  const appDue = force || !saved.appVersionCheckLastAttemptAt || Boolean(saved.appVersionCheckError) || now - saved.appVersionCheckLastAttemptAt >= VERSION_CHECK_INTERVAL_MS;
  if (!piDue && !appDue) return updateStatus({ pi: { ...piPrevious, current: (await piSystemApi.detect()).pi.version, updateAvailable: compare((await piSystemApi.detect()).pi.version, piPrevious.latest) }, app: { ...appPrevious, current: appApi.version(), updateAvailable: compare(appApi.version(), appPrevious.latest), downloadedPath: saved.appVersionCheckDownloadedPath } });
  if (piDue) await settingsApi.set({ key: 'piVersionCheckLastAttemptAt', value: now });
  if (appDue) await settingsApi.set({ key: 'appVersionCheckLastAttemptAt', value: now });
  // app 检查一完成就发通知，不等 pi 检查（npm 网络探测慢时不拖住 app 更新提示）。
  // 推送是尽力送达：渲染层可能尚未订阅，已读标记移到 getPendingNotice/dismissNotice。
  const appStatusPromise = (appDue ? checkApp(appPrevious, now) : Promise.resolve(appPrevious)).then((appResult) => {
    if (appResult.updateAvailable && appResult.latest && appResult.latest !== saved.appVersionCheckNoticedLatest) {
      sendHostEvent('versionCheck', 'updateAvailable', {
        current: ('current' in appResult && typeof appResult.current === 'string') ? appResult.current : appApi.version(),
        latest: appResult.latest,
        releaseUrl: appResult.releaseUrl,
        kind: 'app',
      });
    }
    return appResult;
  });
  const pi = await (piDue ? checkPi(piPrevious, now) : Promise.resolve(piPrevious));
  const appStatus = await appStatusPromise;
  if (pi.updateAvailable && pi.latest && pi.latest !== saved.piVersionCheckNoticedLatest) {
    sendHostEvent('versionCheck', 'updateAvailable', {
      current: pi.current ?? '',
      latest: pi.latest,
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
  // 已读只在用户关闭/点击通知时写（dismissNotice）；拉取不写——组件挂载竞争可能丢弃
  // 首次拉取结果，写已读会让通知永久丢失。重启后未关闭的通知重弹是符合预期的。
  getPendingNotice: async () => {
    const saved = await settingsApi.getAll();
    const appCurrent = appApi.version();
    if (saved.appVersionCheckLatest
      && compare(appCurrent, saved.appVersionCheckLatest)
      && saved.appVersionCheckNoticedLatest !== saved.appVersionCheckLatest) {
      return {
        current: appCurrent,
        latest: saved.appVersionCheckLatest,
        releaseUrl: saved.appVersionCheckReleaseUrl,
        kind: 'app' as const,
      };
    }
    const piCurrent = (await piSystemApi.detect()).pi.version;
    if (saved.piVersionCheckLatest
      && compare(piCurrent, saved.piVersionCheckLatest)
      && saved.piVersionCheckNoticedLatest !== saved.piVersionCheckLatest) {
      return { current: piCurrent ?? '', latest: saved.piVersionCheckLatest, kind: 'pi' as const };
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

export function scheduleVersionChecks(): void {
  void versionCheckApi.check().catch(() => undefined);
}
