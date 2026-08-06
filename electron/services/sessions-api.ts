// piSessions：会话管理（M4，docs §4.4）。
// 列表/切换/重命名/分叉走 pi SDK（SessionManager 静态方法 + runtime.switchSession）；
// 删除 pi 无 API（已确认），壳直接删 JSONL 文件。
// 会话替换后必须 afterSessionReplaced（重订阅 + 重绑扩展 + 推 sessionReplaced）。
import { realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type {
  HostSuccess,
  PiSessionExportResult,
  PiSessionForkResult,
  PiSessionListResult,
  PiSessionPathPayload,
  PiSessionRenamePayload,
  PiSessionRow,
} from '@shared/host-api/contract';
import {
  afterSessionReplaced,
  getActiveRuntime,
} from './pi-runtime-api';
import { settingsApi } from './settings-api';
import { loadPiSdk } from '../utils/pi-loader';

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** macOS /tmp → /private/tmp symlink：路径比较前两边 realpath（AGENTS.md）。 */
function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function currentSessionFile(): string | undefined {
  return getActiveRuntime()?.runtime.session.sessionFile;
}

/** runtime 未启动（用户还没开过 Chat 页）时回退 settings.workspaceCwd。 */
async function resolveCwd(): Promise<string | null> {
  const active = getActiveRuntime();
  if (active) return active.cwd;
  return (await settingsApi.get({ key: 'workspaceCwd' })) ?? null;
}

function toRow(s: {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: Date;
  modified: Date;
}, current?: string): PiSessionRow {
  return {
    path: s.path,
    id: s.id,
    cwd: s.cwd,
    name: s.name,
    firstMessage: s.firstMessage,
    messageCount: s.messageCount,
    created: s.created.toISOString(),
    modified: s.modified.toISOString(),
    isCurrent: samePath(s.path, current),
  };
}

export const sessionsApi = {
  list: async (): Promise<PiSessionListResult> => {
    const cwd = await resolveCwd();
    if (!cwd) return { sessions: [] };
    const sdk = await loadPiSdk();
    const infos = await sdk.SessionManager.list(cwd);
    const current = currentSessionFile();
    const sessions = infos
      .map((s) => toRow(s, current))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  listAll: async (): Promise<PiSessionListResult> => {
    const sdk = await loadPiSdk();
    const infos = await sdk.SessionManager.listAll();
    const current = currentSessionFile();
    const sessions = infos
      .map((s) => toRow(s, current))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  switch: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    // 跨项目切换：目标会话的 cwd 与当前 runtime 不同时先重建 runtime
    const before = getActiveRuntime();
    if (payload.cwd && before && !samePath(payload.cwd, before.cwd)) {
      const { piRuntimeApi } = await import('./pi-runtime-api');
      await piRuntimeApi.start({ cwd: payload.cwd });
      await settingsApi.set({ key: 'workspaceCwd', value: payload.cwd });
    }
    const active = getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    if (samePath(payload.path, currentSessionFile())) return { success: true };
    try {
      const result = await active.runtime.switchSession(payload.path);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      await afterSessionReplaced(active);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  rename: async (payload: PiSessionRenamePayload): Promise<HostSuccess> => {
    const name = payload.name.trim();
    if (!name) return { success: false, error: 'empty name' };
    try {
      const active = getActiveRuntime();
      if (active && samePath(payload.path, active.runtime.session.sessionFile)) {
        // 当前会话：走 runtime 自己的 SessionManager，内存态与文件保持一致
        active.runtime.session.sessionManager.appendSessionInfo(name);
      } else {
        const sdk = await loadPiSdk();
        sdk.SessionManager.open(payload.path).appendSessionInfo(name);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  fork: async (payload: PiSessionPathPayload): Promise<PiSessionForkResult> => {
    const active = getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    try {
      const forked = active.sdk.SessionManager.forkFrom(payload.path, active.cwd);
      const newPath = forked.getSessionFile();
      if (!newPath) return { success: false, error: 'fork produced no session file' };
      const result = await active.runtime.switchSession(newPath);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      await afterSessionReplaced(active);
      return { success: true, path: newPath };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    try {
      const active = getActiveRuntime();
      if (active && samePath(payload.path, active.runtime.session.sessionFile)) {
        // 删当前会话文件前先切到全新会话，避免 runtime 继续往已删文件追加
        await active.runtime.newSession();
        await afterSessionReplaced(active);
      }
      await rm(payload.path, { force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  exportHtml: async (payload: PiSessionPathPayload): Promise<PiSessionExportResult> => {
    const active = getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    try {
      // v1 简化：exportToHtml 挂在 AgentSession 上，只能导「当前会话」；
      // 目标不是当前会话时先切过去。默认导出到会话同目录。
      if (!samePath(payload.path, active.runtime.session.sessionFile)) {
        const result = await active.runtime.switchSession(payload.path);
        if (result.cancelled) return { success: false, error: 'cancelled' };
        await afterSessionReplaced(active);
      }
      const exported = await active.runtime.session.exportToHtml();
      return { success: true, path: exported };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },
};
