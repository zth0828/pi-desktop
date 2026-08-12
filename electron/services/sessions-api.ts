// piSessions：会话管理（M4，docs §4.4）。
// 列表/切换/重命名/分叉走 pi SDK（SessionManager 静态方法 + runtime.switchSession）；
// 删除 pi 无 SDK API（已确认），对齐 pi `/resume`：优先移入系统废纸篓。
// 会话替换后必须 afterSessionReplaced（重订阅 + 重绑扩展 + 推 sessionReplaced）。
import { rm } from 'node:fs/promises';
import { shell } from 'electron';
import type {
  HostSuccess,
  PiSessionExportResult,
  PiSessionForkResult,
  PiSessionListResult,
  PiSessionPathPayload,
  PiSessionArchivePayload,
  PiSessionProjectArchivePayload,
  PiSessionRenamePayload,
  PiSessionRow,
  PiSessionSearchPayload,
  PiSessionSearchResult,
} from '@shared/host-api/contract';
import {
  afterSessionReplaced,
  activateSessionRuntime,
  createSessionRuntime,
  getActiveRuntime,
  getLiveSessionRows,
  getRuntimeForSession,
  isSessionRunning,
} from './pi-runtime-api';
import { settingsApi } from './settings-api';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';
import { samePath } from '../utils/same-path';
import { ensureSessionExportDirectory, sessionExportPath } from '../utils/session-export';
import { searchSessions } from './session-search';

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function currentSessionFile(): string | undefined {
  return getActiveRuntime()?.runtime.session.sessionFile;
}

const ARCHIVE_CUSTOM_TYPE = 'pi-desktop.archive';

function sessionManagerFor(path: string, sdk: PiSdk) {
  const active = getActiveRuntime();
  if (active && samePath(path, active.runtime.session.sessionFile)) {
    return active.runtime.session.sessionManager;
  }
  return sdk.SessionManager.open(path);
}

function isArchived(path: string, sdk: PiSdk): boolean {
  const entries = sessionManagerFor(path, sdk).getEntries();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: string; customType?: string; data?: { archived?: unknown } };
    if (entry.type === 'custom' && entry.customType === ARCHIVE_CUSTOM_TYPE) {
      return entry.data?.archived === true;
    }
  }
  return false;
}

function setArchived(path: string, archived: boolean, sdk: PiSdk): void {
  sessionManagerFor(path, sdk).appendCustomEntry(ARCHIVE_CUSTOM_TYPE, { archived });
}

function searchableMessageText(message: unknown): string {
  const candidate = message as { content?: unknown; summary?: unknown };
  if (typeof candidate.content === 'string') return candidate.content;
  if (Array.isArray(candidate.content)) {
    return candidate.content
      .flatMap((block) => {
        if (!block || typeof block !== 'object') return [];
        const value = block as { type?: unknown; text?: unknown };
        return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
      })
      .join('\n');
  }
  return typeof candidate.summary === 'string' ? candidate.summary : '';
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
}, current: string | undefined, sdk: PiSdk): PiSessionRow {
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
    isRunning: isSessionRunning(s.path),
    archived: isArchived(s.path, sdk),
  };
}

type SessionInfo = Parameters<typeof toRow>[0];

function mergeLiveSessions(sessions: SessionInfo[]): SessionInfo[] {
  const merged = new Map(sessions.map((session) => [session.path, session]));
  for (const session of getLiveSessionRows()) {
    if (!merged.has(session.path)) merged.set(session.path, session);
  }
  return [...merged.values()];
}

export const sessionsApi = {
  list: async (): Promise<PiSessionListResult> => {
    const cwd = await resolveCwd();
    if (!cwd) return { sessions: [] };
    const sdk = await loadPiSdk();
    const infos = await sdk.SessionManager.list(cwd);
    const current = currentSessionFile();
    const sessions = mergeLiveSessions(infos)
      .map((s) => toRow(s, current, sdk))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  listAll: async (): Promise<PiSessionListResult> => {
    const sdk = await loadPiSdk();
    const infos = await sdk.SessionManager.listAll();
    const current = currentSessionFile();
    const sessions = mergeLiveSessions(infos)
      .map((s) => toRow(s, current, sdk))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  search: async (payload: PiSessionSearchPayload): Promise<PiSessionSearchResult> => {
    const query = payload.query.trim();
    if (!query) return { sessions: [] };
    const sdk = await loadPiSdk();
    const infos = await sdk.SessionManager.listAll();
    const current = currentSessionFile();
    const limit = Math.max(1, Math.min(payload.limit ?? 50, 100));
    const candidates = searchSessions(infos, query, limit);
    const preciseCandidates = candidates.map((candidate) => {
      if (candidate.match === 'name') return candidate;
      const messageTexts = sdk.SessionManager
        .open(candidate.session.path)
        .buildSessionContext()
        .messages
        .map(searchableMessageText);
      return searchSessions([{ ...candidate.session, messageTexts }], query, 1)[0] ?? candidate;
    });
    const sessions = preciseCandidates
      .slice(0, limit)
      .map(({ session, match, snippet, messageIndex }) => ({
        ...toRow(session, current, sdk),
        match,
        snippet,
        messageIndex,
      }));
    return { sessions };
  },

  switch: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    const live = getRuntimeForSession(payload.path);
    if (live) {
      activateSessionRuntime(live);
      if (payload.cwd) await settingsApi.set({ key: 'workspaceCwd', value: payload.cwd });
      return { success: true };
    }
    // 跨项目切换：目标会话的 cwd 与当前 runtime 不同时先重建 runtime
    let before = getActiveRuntime();
    if (!before && payload.cwd) {
      const { piRuntimeApi } = await import('./pi-runtime-api');
      await piRuntimeApi.start({ cwd: payload.cwd });
      await settingsApi.set({ key: 'workspaceCwd', value: payload.cwd });
      before = getActiveRuntime();
    }
    if (payload.cwd && before && !samePath(payload.cwd, before.cwd)) {
      const { piRuntimeApi } = await import('./pi-runtime-api');
      await piRuntimeApi.start({ cwd: payload.cwd });
      await settingsApi.set({ key: 'workspaceCwd', value: payload.cwd });
    }
    const active = getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    if (samePath(payload.path, currentSessionFile())) return { success: true };
    try {
      if (active.runtime.session.isStreaming) {
        await createSessionRuntime(payload.cwd ?? active.cwd, payload.path);
        return { success: true };
      }
      const result = await active.runtime.switchSession(payload.path);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      await afterSessionReplaced(active);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  rename: async (payload: PiSessionRenamePayload): Promise<HostSuccess> => {
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
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
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
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

  archive: async (payload: PiSessionArchivePayload): Promise<HostSuccess> => {
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    try {
      const sdk = await loadPiSdk();
      setArchived(payload.path, payload.archived, sdk);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  archiveProject: async (payload: PiSessionProjectArchivePayload): Promise<HostSuccess> => {
    try {
      const sdk = await loadPiSdk();
      const projectSessions = await sdk.SessionManager.list(payload.cwd);
      if (projectSessions.some((session) => isSessionRunning(session.path))) {
        return { success: false, error: 'project has a running session' };
      }
      for (const session of projectSessions) setArchived(session.path, payload.archived, sdk);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    try {
      const active = getActiveRuntime();
      if (active && samePath(payload.path, active.runtime.session.sessionFile)) {
        // 删当前会话文件前先切到全新会话，避免 runtime 继续往已删文件追加
        await active.runtime.newSession();
        await afterSessionReplaced(active);
      }
      // 对齐 pi `/resume` 的删除语义：真实应用优先移到系统废纸篓；
      // E2E 隔离目录直接删除，避免把测试会话灌进用户废纸篓。
      if (process.env.PI_DESKTOP_USER_DATA_DIR) {
        await rm(payload.path, { force: true });
      } else {
        try {
          await shell.trashItem(payload.path);
        } catch {
          await rm(payload.path, { force: true });
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  exportHtml: async (payload: PiSessionPathPayload): Promise<PiSessionExportResult> => {
    const active = getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    try {
      // exportToHtml 挂在 AgentSession 上，只能导「当前会话」；目标不是当前会话时先切过去。
      if (!samePath(payload.path, active.runtime.session.sessionFile)) {
        const result = await active.runtime.switchSession(payload.path);
        if (result.cancelled) return { success: false, error: 'cancelled' };
        await afterSessionReplaced(active);
      }
      const target = await sessionExportPath(payload.path);
      const exported = await active.runtime.session.exportToHtml(target);
      await settingsApi.set({ key: 'lastSessionExportPath', value: exported });
      return { success: true, path: exported };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  getExportInfo: async () => ({
    directory: await ensureSessionExportDirectory(),
    lastPath: await settingsApi.get({ key: 'lastSessionExportPath' }),
  }),
};
