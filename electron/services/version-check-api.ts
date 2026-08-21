import type { VersionCheckSnapshot, VersionCheckStatus } from '@shared/host-api/contract';
import { settingsApi } from './settings-api';
import { piSystemApi } from './pi-system-api';
import { appApi } from './app-api';
import { compareSemver, parseSemver } from '../utils/semver';
import { hostFetch } from '../utils/host-fetch';
import { sendHostEvent } from '../main/ipc/host-events';

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

function selectAssetName(assets: Array<{ name?: string }>): string | undefined {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  const names = assets.map((asset) => asset.name).filter((name): name is string => Boolean(name && name.includes(`-${arch}.`)));
  if (process.platform === 'darwin') return names.find((name) => name.endsWith('.dmg'));
  if (process.platform === 'win32') return names.find((name) => name.includes('-Setup-') && name.endsWith('.exe'));
  return names.find((name) => name.endsWith('.AppImage')) ?? names.find((name) => name.endsWith('.deb'));
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

async function checkApp(previous: VersionCheckStatus & { releaseUrl?: string; assetName?: string }, now: number) {
  const current = appApi.version();
  const url = process.env.PI_DESKTOP_GITHUB_API_URL ?? GITHUB_RELEASE_URL;
  try {
    const response = await hostFetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'Pi-Desktop' } });
    if (!response.ok) throw new Error(`Release request failed (${response.status})`);
    const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean; html_url?: string; assets?: Array<{ name?: string }> };
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
  const piDue = force || !saved.piVersionCheckLastAttemptAt || now - saved.piVersionCheckLastAttemptAt >= VERSION_CHECK_INTERVAL_MS;
  const appDue = force || !saved.appVersionCheckLastAttemptAt || now - saved.appVersionCheckLastAttemptAt >= VERSION_CHECK_INTERVAL_MS;
  if (!piDue && !appDue) return updateStatus({ pi: { ...piPrevious, current: (await piSystemApi.detect()).pi.version, updateAvailable: compare((await piSystemApi.detect()).pi.version, piPrevious.latest) }, app: { ...appPrevious, current: appApi.version(), updateAvailable: compare(appApi.version(), appPrevious.latest), downloadedPath: saved.appVersionCheckDownloadedPath } });
  if (piDue) await settingsApi.set({ key: 'piVersionCheckLastAttemptAt', value: now });
  if (appDue) await settingsApi.set({ key: 'appVersionCheckLastAttemptAt', value: now });
  const [pi, appStatus] = await Promise.all([
    piDue ? checkPi(piPrevious, now) : Promise.resolve(piPrevious),
    appDue ? checkApp(appPrevious, now) : Promise.resolve(appPrevious),
  ]);
  if (appStatus.updateAvailable && appStatus.latest && appStatus.latest !== saved.appVersionCheckNoticedLatest) {
    sendHostEvent('versionCheck', 'updateAvailable', {
      current: ('current' in appStatus && typeof appStatus.current === 'string') ? appStatus.current : appApi.version(),
      latest: appStatus.latest,
      releaseUrl: appStatus.releaseUrl,
      kind: 'app',
    });
    await settingsApi.set({ key: 'appVersionCheckNoticedLatest', value: appStatus.latest });
  }
  if (pi.updateAvailable && pi.latest && pi.latest !== saved.piVersionCheckNoticedLatest) {
    sendHostEvent('versionCheck', 'updateAvailable', {
      current: pi.current ?? '',
      latest: pi.latest,
      kind: 'pi',
    });
    await settingsApi.set({ key: 'piVersionCheckNoticedLatest', value: pi.latest });
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
};

export function scheduleVersionChecks(): void {
  void versionCheckApi.check().catch(() => undefined);
}
