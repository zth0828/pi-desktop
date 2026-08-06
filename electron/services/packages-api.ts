// piPackages：扩展包管理（M5）。全部经 pi SDK 的 DefaultPackageManager
// （list/installAndPersist/removeAndPersist/update/checkForAvailableUpdates），
// 壳不直接改 settings.json 的 packages 字段。进度经 piPackages.progress 事件转发。
// 市场浏览 v1 不做（pi.dev API 未确认，docs §4.6）。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  HostSuccess,
  PiPackageCheckUpdatesResult,
  PiPackageInstallPayload,
  PiPackageListResult,
  PiPackageRemovePayload,
  PiPackageRow,
  PiPackageUpdatePayload,
} from '@shared/host-api/contract';
import type { DefaultPackageManager } from '@earendil-works/pi-coding-agent';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';
import { getActiveRuntime } from './pi-runtime-api';
import { settingsApi } from './settings-api';

// 用类而非 PackageManager 接口：checkForAvailableUpdates 只在 DefaultPackageManager 上
type Pm = InstanceType<typeof DefaultPackageManager>;
type PmEntry = { key: string; pm: Pm };
let cached: PmEntry | null = null;

/** runtime 活动则复用其 settingsManager（避免壳另开实例写 settings.json 后被运行时缓存覆盖）。 */
async function getPackageManager(): Promise<{ sdk: PiSdk; pm: Pm; agentDir: string }> {
  const sdk = await loadPiSdk();
  const agentDir = sdk.getAgentDir();
  const active = getActiveRuntime();
  const cwd = active?.cwd ?? (await settingsApi.get({ key: 'workspaceCwd' })) ?? homedir();
  // generation 进 key：会话替换后 services/settingsManager 可能已重建
  const key = `${cwd}::${agentDir}::${active ? `rt${active.generation}` : 'standalone'}`;
  if (cached?.key === key) return { sdk, pm: cached.pm, agentDir };
  const settingsManager =
    active?.runtime.services.settingsManager ?? sdk.SettingsManager.create(cwd, agentDir);
  const pm = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager });
  pm.setProgressCallback((event) => {
    sendHostEvent('piPackages', 'progress', event);
  });
  cached = { key, pm };
  return { sdk, pm, agentDir };
}

function displayName(source: string): string {
  if (source.startsWith('npm:')) {
    // npm:@scope/name@1.2.3 → @scope/name；npm:name@1.2.3 → name
    const spec = source.slice(4);
    if (spec.startsWith('@')) return `@${spec.split('@')[1] ?? spec}`;
    return spec.split('@')[0] ?? spec;
  }
  if (/^(git:|https?:|ssh:|git@)/.test(source)) {
    const base = source.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? source;
    return base.replace(/\.git$/, '');
  }
  return path.basename(source);
}

function installedVersion(installedPath?: string): string | undefined {
  if (!installedPath) return undefined;
  try {
    const manifest = path.join(installedPath, 'package.json');
    if (!existsSync(manifest)) return undefined;
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const packagesApi = {
  list: async (): Promise<PiPackageListResult> => {
    const { pm } = await getPackageManager();
    const packages: PiPackageRow[] = pm.listConfiguredPackages().map((p) => ({
      source: p.source,
      scope: p.scope,
      filtered: p.filtered,
      installedPath: p.installedPath,
      version: installedVersion(p.installedPath),
      name: displayName(p.source),
    }));
    return { packages };
  },

  install: async (payload: PiPackageInstallPayload): Promise<HostSuccess> => {
    const source = payload.source.trim();
    if (!source) return { success: false, error: 'empty source' };
    try {
      const { pm } = await getPackageManager();
      await pm.installAndPersist(source);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiPackageRemovePayload): Promise<HostSuccess> => {
    try {
      const { pm } = await getPackageManager();
      await pm.removeAndPersist(payload.source, { local: payload.scope === 'project' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  update: async (payload: PiPackageUpdatePayload): Promise<HostSuccess> => {
    try {
      const { pm } = await getPackageManager();
      await pm.update(payload.source);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  checkUpdates: async (): Promise<PiPackageCheckUpdatesResult> => {
    const { pm } = await getPackageManager();
    const updates = await pm.checkForAvailableUpdates();
    return {
      updates: updates.map((u) => ({
        source: u.source,
        displayName: u.displayName,
        type: u.type,
        scope: u.scope,
      })),
    };
  },
};
