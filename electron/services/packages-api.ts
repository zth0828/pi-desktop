// piPackages：扩展包管理。所有 pi SDK package-manager 操作经 adapter port。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  HostSuccess,
  PiPackageCheckUpdatesResult,
  PiPackageCatalogQuery,
  PiPackageCatalogResult,
  PiPackageDetailQuery,
  PiPackageDetailResult,
  PiPackageInstallPayload,
  PiPackageListResult,
  PiPackageRemovePayload,
  PiPackageRow,
  PiPackageUpdatePayload,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiAdapter, type PiPackageManagerHandle } from './pi-adapter';
import { resolveRuntimeForContext } from './pi-runtime-api';
import type { HostActionContext } from '../main/ipc/host-contract';
import { settingsApi } from './settings-api';
import { fetchPackageCatalog, fetchPackageDetail } from './package-catalog';

function displayName(source: string): string {
  if (source.startsWith('npm:')) {
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
    const parsed = JSON.parse(readFileSync(path.join(installedPath, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function getPackageManager(ctx?: HostActionContext): Promise<{
  adapter: Awaited<ReturnType<typeof loadPiAdapter>>;
  handle: PiPackageManagerHandle;
  agentDir: string;
}> {
  const adapter = await loadPiAdapter();
  const active = resolveRuntimeForContext(ctx);
  const cwd = active?.cwd ?? (await settingsApi.get({ key: 'workspaceCwd' })) ?? process.cwd();
  const agentDir = adapter.paths.getAgentDir();
  const handle = await adapter.packages.create({ cwd, agentDir, scope: 'user' });
  return { adapter, handle, agentDir };
}

export const packagesApi = {
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiPackageListResult> => {
    const { adapter, handle } = await getPackageManager(ctx);
    const packages: PiPackageRow[] = adapter.packages.list(handle).map((p) => ({
      source: p.source,
      scope: p.scope,
      filtered: p.filtered,
      installedPath: p.installedPath,
      version: installedVersion(p.installedPath),
      name: displayName(p.source),
    }));
    return { packages };
  },

  install: async (payload: PiPackageInstallPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    const source = payload.source.trim();
    if (!source) return { success: false, error: 'empty source' };
    try {
      const { adapter, handle } = await getPackageManager(ctx);
      const off = adapter.packages.onProgress(handle, (event) => sendHostEvent('piPackages', 'progress', event));
      try { await adapter.packages.install(handle, source); } finally { off(); }
      adapter.packages.invalidate();
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiPackageRemovePayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    try {
      const { adapter, handle } = await getPackageManager(ctx);
      const off = adapter.packages.onProgress(handle, (event) => sendHostEvent('piPackages', 'progress', event));
      let removed = false;
      const local = payload.scope === 'project';
      try {
        removed = await adapter.packages.remove(handle, payload.source, local);
      } finally { off(); }
      adapter.packages.invalidate();

      return removed ? { success: true } : { success: false, error: 'package source not found' };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  update: async (payload: PiPackageUpdatePayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    try {
      const { adapter, handle } = await getPackageManager(ctx);
      const off = adapter.packages.onProgress(handle, (event) => sendHostEvent('piPackages', 'progress', event));
      try { await adapter.packages.update(handle, payload.source); } finally { off(); }
      adapter.packages.invalidate();
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  checkUpdates: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiPackageCheckUpdatesResult> => {
    const { adapter, handle } = await getPackageManager(ctx);
    const updates = await adapter.packages.checkUpdates(handle);
    return { updates: updates.map((u) => ({ source: u.source, displayName: u.displayName, type: u.type, scope: u.scope })) };
  },

  catalog: async (payload: PiPackageCatalogQuery): Promise<PiPackageCatalogResult> => fetchPackageCatalog(payload),
  detail: async (payload: PiPackageDetailQuery): Promise<PiPackageDetailResult> => fetchPackageDetail(payload),
};
