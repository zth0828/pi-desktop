// piSessions：会话管理。
// 列表/切换/重命名/分叉走 pi SDK（SessionManager 静态方法 + runtime.switchSession）；
// 删除 pi 无 SDK API（已确认），对齐 pi `/resume`：优先移入系统废纸篓。
// 会话替换后必须 afterSessionReplaced（重订阅 + 重绑扩展 + 推 sessionReplaced）。
import { rm } from 'node:fs/promises';
import { shell } from 'electron';
import { sendHostEvent } from '../main/ipc/host-events';
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
  awaitPendingPrewarm,
  clearPrewarmMark,
  consumePrewarmedSessionRuntime,
  createSessionRuntime,
  createSessionRuntimeForWindow,
  detachRuntimesFromSessionFile,
  getActiveRuntime,
  getLiveSessionRows,
  getRuntimeForSession,
  sendRuntimeStateToWindow,
  isSessionRunning,
} from './pi-runtime-api';
import {
  bindWindowSession,
  hasSessionInOtherWindow,
  isMainWindow,
} from '../main/window-manager';
import type { HostActionContext } from '../main/ipc/host-contract';
import { settingsApi } from './settings-api';
import { loadPiAdapter, type PiSessionCatalogPort, type PiSessionDocumentHandle } from './pi-adapter';
import { samePath } from '../utils/same-path';
import { stripAttachmentEnvelope } from '@shared/message-attachments';
import { ensureSessionExportDirectory, sessionExportPath } from '../utils/session-export';
import { searchSessions } from './session-search';
import { timingMark } from '../utils/timing';

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** switch 成功后把调用方窗口绑定到目标会话（ctx 缺省 = 旧调用，跳过）。 */
function bindSenderWindow(ctx: HostActionContext | undefined, sessionPath: string): void {
  if (ctx) bindWindowSession(ctx.sender.id, sessionPath);
}

function currentSessionFile(): string | undefined {
  return getActiveRuntime()?.adapterRuntime.session.view.sessionFile;
}

const ARCHIVE_CUSTOM_TYPE = 'pi-desktop.archive';

function sessionManagerFor(path: string, sessions: PiSessionCatalogPort): PiSessionDocumentHandle {
  const active = getActiveRuntime();
  if (active && samePath(path, active.adapterRuntime.session.view.sessionFile)) {
    return active.adapterRuntime.session.view.sessionManager;
  }
  return sessions.open(path);
}

function isArchived(path: string, sessions: PiSessionCatalogPort): boolean {
  const entries = sessions.getEntries(sessionManagerFor(path, sessions));
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: string; customType?: string; data?: { archived?: unknown } };
    if (entry.type === 'custom' && entry.customType === ARCHIVE_CUSTOM_TYPE) {
      return entry.data?.archived === true;
    }
  }
  return false;
}

function setArchived(path: string, archived: boolean, sessions: PiSessionCatalogPort): void {
  sessions.appendCustomEntry(sessionManagerFor(path, sessions), ARCHIVE_CUSTOM_TYPE, { archived });
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

/**
 * 与渲染层展示同序的完整分支消息（含压缩摘要）。搜索 messageIndex 用它对齐，
 * 否则压缩后 messageIndex 相对 buildSessionContext（摘要+尾部）计算，跳转会错位。
 */
function branchSearchableMessages(sessions: PiSessionCatalogPort, sessionPath: string): string[] {
  const texts: string[] = [];
  const manager = sessions.open(sessionPath);
  for (const entry of sessions.getBranch(manager)) {
    for (const message of sessions.toContextMessages(entry)) {
      // 附件信封/文件块不属于可搜索正文，命中展示时也不能带出
      texts.push(stripAttachmentEnvelope(searchableMessageText(message)));
    }
  }
  return texts;
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
}, current: string | undefined, archived: boolean): PiSessionRow {
  // 附件 XML 信封不属于标题文字：name/firstMessage 都可能带（pi 按首条消息自动命名时），
  // 列表出口统一剥离，历史脏标题在展示层一并清净
  const cleanName = s.name ? stripAttachmentEnvelope(s.name) : '';
  return {
    path: s.path,
    id: s.id,
    cwd: s.cwd,
    name: cleanName || undefined,
    firstMessage: stripAttachmentEnvelope(s.firstMessage),
    messageCount: s.messageCount,
    created: s.created.toISOString(),
    modified: s.modified.toISOString(),
    isCurrent: samePath(s.path, current),
    isRunning: isSessionRunning(s.path),
    archived,
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
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSessionListResult> => {
    const cwd = await resolveCwd();
    if (!cwd) return { sessions: [] };
    const adapter = await loadPiAdapter();
    const infos = await adapter.sessions.list(cwd);
    const current = ctx?.sessionPath ?? currentSessionFile();
    const sessions = mergeLiveSessions(infos)
      .map((s) => toRow(s, current, isArchived(s.path, adapter.sessions)))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  listAll: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSessionListResult> => {
    const adapter = await loadPiAdapter();
    const infos = await adapter.sessions.listAll();
    const current = ctx?.sessionPath ?? currentSessionFile();
    const sessions = mergeLiveSessions(infos)
      .map((s) => toRow(s, current, isArchived(s.path, adapter.sessions)))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  search: async (payload: PiSessionSearchPayload, ctx?: HostActionContext): Promise<PiSessionSearchResult> => {
    const query = payload.query.trim();
    if (!query) return { sessions: [] };
    const adapter = await loadPiAdapter();
    const infos = await adapter.sessions.listAll();
    const current = ctx?.sessionPath ?? currentSessionFile();
    const limit = Math.max(1, Math.min(payload.limit ?? 50, 100));
    // 搜索结果 snippet 直接展示原文，先剥离附件信封再进索引/命中
    const strippedInfos = infos.map((info) => ({
      ...info,
      name: info.name ? stripAttachmentEnvelope(info.name) || undefined : undefined,
      firstMessage: stripAttachmentEnvelope(info.firstMessage),
      allMessagesText: info.allMessagesText ? stripAttachmentEnvelope(info.allMessagesText) : '',
    }));
    const candidates = searchSessions(strippedInfos, query, limit);
    const preciseCandidates = candidates.map((candidate) => {
      if (candidate.match === 'name' || !candidate.session.path) return candidate;
      const candidatePath = candidate.session.path;
      const messageTexts = branchSearchableMessages(adapter.sessions, candidatePath);
      return searchSessions([{ ...candidate.session, messageTexts }], query, 1)[0] ?? candidate;
    });
    const sessions = preciseCandidates
      .slice(0, limit)
      .map(({ session, match, snippet, messageIndex }) => ({
        ...toRow(session, current, isArchived(session.path, adapter.sessions)),
        match,
        snippet,
        messageIndex,
      }));
    return { sessions };
  },

  switch: async (payload: PiSessionPathPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    timingMark('switch:recv');
    const activeForCheck = getActiveRuntime();
    const boundToActive = Boolean(
      ctx?.sessionPath
      && activeForCheck?.adapterRuntime.session.view.sessionFile
      && samePath(ctx.sessionPath, activeForCheck.adapterRuntime.session.view.sessionFile),
    );
    // 独立窗口 attach：优先消费 openDetached 的预热产物（在途等完成），
    // 按 attach 语义绑定（activate=false 建出来的，不挤占全局 active）
    if (ctx?.sessionPath && !boundToActive && payload.cwd
      && await consumePrewarmedSessionRuntime(payload.path)) {
      timingMark('switch:prewarm-hit');
      bindSenderWindow(ctx, payload.path);
      return { success: true };
    }
    // 非 attach 调用方撞上在途预热（罕见竞态）：等其完成再按 live 复用，避免重复建 runtime
    await awaitPendingPrewarm(payload.path);
    const live = getRuntimeForSession(payload.path);
    if (live) {
      clearPrewarmMark(payload.path);
      timingMark('switch:live-hit');
      // 独立窗口切换到已有 runtime 时只向该窗口发状态；不能 activate 广播，
      // 否则其他窗口可能把这次切换误认为自己的 session replacement。
      bindSenderWindow(ctx, payload.path);
      if (ctx && !isMainWindow(ctx.sender.id)) sendRuntimeStateToWindow(live, ctx);
      else activateSessionRuntime(live);
      if (payload.cwd) await settingsApi.set({ key: 'workspaceCwd', value: payload.cwd });
      return { success: true };
    }
    // 调用方窗口绑定着非活动会话（独立窗口 attach/切会话）时，
    // 为目标会话单独建保活 runtime，不挤占全局 active（主窗口）的运行时。
    if (ctx?.sessionPath && !boundToActive && payload.cwd) {
      try {
        timingMark('switch:create-runtime:start');
        await createSessionRuntime(payload.cwd, payload.path, { activate: false });
        timingMark('switch:create-runtime:done');
        bindSenderWindow(ctx, payload.path);
        return { success: true };
      } catch (err) {
        return { success: false, error: toError(err) };
      }
    }
    // 当前 runtime 还被其他窗口查看时，不能在它上面原地 switch，也不能走
    // 跨工作区 start 释放它。为发起窗口直接创建目标 runtime 并定向推送状态。
    const current = getActiveRuntime();
    const currentPath = current?.adapterRuntime.session.view.sessionFile;
    if (
      ctx
      && current
      && currentPath
      && hasSessionInOtherWindow(currentPath, ctx.sender.id)
    ) {
      try {
        await createSessionRuntimeForWindow(payload.cwd ?? current.cwd, payload.path, ctx);
        if (payload.cwd) await settingsApi.set({ key: 'workspaceCwd', value: payload.cwd });
        return { success: true };
      } catch (err) {
        return { success: false, error: toError(err) };
      }
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
    if (samePath(payload.path, currentSessionFile())) {
      bindSenderWindow(ctx, payload.path);
      return { success: true };
    }
    try {
      if (active.adapterRuntime.session.view.isStreaming) {
        await createSessionRuntime(payload.cwd ?? active.cwd, payload.path);
        bindSenderWindow(ctx, payload.path);
        return { success: true };
      }
      const result = await active.adapterRuntime.switchSession(payload.path);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      await afterSessionReplaced(active, ctx);
      bindSenderWindow(ctx, payload.path);
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
      const adapter = await loadPiAdapter();
      if (active && samePath(payload.path, active.adapterRuntime.session.view.sessionFile)) {
        adapter.sessions.appendSessionInfo(active.adapterRuntime.session.view.sessionManager, name);
      } else {
        adapter.sessions.appendSessionInfo(adapter.sessions.open(payload.path), name);
      }
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'rename' });
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
      const adapter = await loadPiAdapter();
      const forked = adapter.sessions.forkFrom(payload.path, active.cwd);
      const newPath = forked.path;
      if (!newPath) return { success: false, error: 'fork produced no session file' };
      const result = await active.adapterRuntime.switchSession(newPath);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      await afterSessionReplaced(active);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'fork' });
      return { success: true, path: newPath };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  archive: async (payload: PiSessionArchivePayload): Promise<HostSuccess> => {
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    try {
      const adapter = await loadPiAdapter();
      setArchived(payload.path, payload.archived, adapter.sessions);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'archive' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  archiveProject: async (payload: PiSessionProjectArchivePayload): Promise<HostSuccess> => {
    try {
      const adapter = await loadPiAdapter();
      const projectSessions = await adapter.sessions.list(payload.cwd);
      if (projectSessions.some((session) => isSessionRunning(session.path))) {
        return { success: false, error: 'project has a running session' };
      }
      for (const session of projectSessions) setArchived(session.path, payload.archived, adapter.sessions);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'archive' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    try {
      // 任一窗口/面板打开着该会话都先切到全新会话，避免 runtime 往已删文件追加
      await detachRuntimesFromSessionFile(payload.path);
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
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'remove' });
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
      if (!samePath(payload.path, active.adapterRuntime.session.view.sessionFile)) {
        const result = await active.adapterRuntime.switchSession(payload.path);
        if (result.cancelled) return { success: false, error: 'cancelled' };
        await afterSessionReplaced(active);
      }
      const target = await sessionExportPath(payload.path);
      const exported = await active.adapterRuntime.session.exportToHtml(target);
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
