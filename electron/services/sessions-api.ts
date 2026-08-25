// piSessions：会话管理。
// 列表/切换/重命名/分叉走 pi SDK（SessionManager 静态方法 + runtime.switchSession）；
// 删除 pi 无 SDK API（已确认），对齐 pi `/resume`：优先移入系统废纸篓。
// 会话替换后必须 afterSessionReplaced（重订阅 + 重绑扩展 + 推 sessionReplaced）。
import { readFile, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
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
  PiSessionSearchRow,
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
  hasRuntimeWithCwd,
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
import { hashSessionPath, safeErrorFields, writePiDiagnostic } from '../utils/pi-diagnostic-log';
import { stripAttachmentEnvelope } from '@shared/message-attachments';
import { toModelUnavailableError } from '@shared/provider-error';
import { ensureSessionExportDirectory, sessionExportPath } from '../utils/session-export';
import { searchSessions } from './session-search';
import { serializeSessionOp } from './session-mutex';
import { timingMark } from '../utils/timing';
import { readSessionArchivedFlag } from '../utils/session-tail';

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * switch 失败的统一出口：模型不可用（wrong-model 文本分类）时抛
 * MODEL_UNAVAILABLE HostError，让渲染层拿到 code 提供换模型自救入口；
 * 其余错误维持 success:false 返回（旧会话仍可用的语义不变）。
 */
function switchFailure(err: unknown): HostSuccess {
  const message = toError(err);
  const modelError = toModelUnavailableError(message);
  if (modelError) throw modelError;
  return { success: false, error: message };
}

/** 读会话文件 header 的 cwd（删除后目录清理需要知道它属于哪个工作区）。 */
async function sessionHeaderCwd(sessionPath: string): Promise<string | null> {
  try {
    const firstLine = (await readFile(sessionPath, 'utf8')).split('\n', 1)[0];
    const header = JSON.parse(firstLine) as { type?: string; cwd?: unknown };
    return header.type === 'session' && typeof header.cwd === 'string' ? header.cwd : null;
  } catch {
    return null;
  }
}

/** switch 成功后把调用方窗口绑定到目标会话（ctx 缺省 = 旧调用，跳过）。 */
function bindSenderWindow(ctx: HostActionContext | undefined, sessionPath: string): void {
  if (ctx) bindWindowSession(ctx.sender.id, sessionPath);
}

function currentSessionFile(): string | undefined {
  return getActiveRuntime()?.adapterRuntime.session.view.sessionFile;
}

const ARCHIVE_CUSTOM_TYPE = 'pi-desktop.archive';

type SessionMetadataCacheEntry = {
  mtimeMs: number;
  size: number;
  archived: boolean;
};

export const sessionMetadataCache = new Map<string, SessionMetadataCacheEntry>();

export function clearSessionMetadataCache(): void {
  sessionMetadataCache.clear();
}

function sessionManagerFor(path: string, sessions: PiSessionCatalogPort): PiSessionDocumentHandle {
  const active = getActiveRuntime();
  if (active && samePath(path, active.adapterRuntime.session.view.sessionFile)) {
    return active.adapterRuntime.session.view.sessionManager;
  }
  return sessions.open(path);
}

function isArchivedForActive(
  active: NonNullable<ReturnType<typeof getActiveRuntime>>,
  sessions: PiSessionCatalogPort,
): boolean {
  const entries = sessions.getEntries(active.adapterRuntime.session.view.sessionManager);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: string; customType?: string; data?: { archived?: unknown } };
    if (entry.type === 'custom' && entry.customType === ARCHIVE_CUSTOM_TYPE) {
      return entry.data?.archived === true;
    }
  }
  return false;
}

async function resolveIsArchived(
  sessionPath: string,
  sessions: PiSessionCatalogPort,
): Promise<boolean> {
  const active = getActiveRuntime();
  if (active && samePath(sessionPath, active.adapterRuntime.session.view.sessionFile)) {
    return isArchivedForActive(active, sessions);
  }

  try {
    const fileStat = await stat(sessionPath);
    const cached = sessionMetadataCache.get(sessionPath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.archived;
    }
    const archived = await readSessionArchivedFlag(sessionPath);
    sessionMetadataCache.set(sessionPath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      archived,
    });
    return archived;
  } catch {
    return false;
  }
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

/**
 * 单个会话条目转列表行：坏文件（损坏/权限异常）跳过并记诊断，
 * 不能让一个坏条目拖垮整个列表（侧栏会一个会话都不显示）。
 */
async function toRowSafely(
  session: SessionInfo,
  current: string | undefined,
  sessions: PiSessionCatalogPort,
  action: string,
): Promise<PiSessionRow | null> {
  try {
    const archived = await resolveIsArchived(session.path, sessions);
    return toRow(session, current, archived);
  } catch (err) {
    writePiDiagnostic({
      level: 'warning',
      event: 'session.list-entry-failed',
      module: 'sessions',
      action,
      sessionPathHash: hashSessionPath(session.path),
      ...safeErrorFields(err),
    });
    return null;
  }
}

/**
 * switch 成功路径上持久化 workspaceCwd 的单点出口。持久化失败只记诊断、
 * 不中断返回：runtime 已完成切换，因 settings 写入失败回滚整个 switch
 * 反而留下半切换状态（下次重启恢复到旧工作区）。
 */
async function commitWorkspaceCwd(cwd: string | undefined): Promise<void> {
  if (!cwd) return;
  try {
    await settingsApi.set({ key: 'workspaceCwd', value: cwd });
  } catch (err) {
    writePiDiagnostic({
      level: 'error',
      event: 'session.workspace-cwd-persist-failed',
      module: 'sessions',
      action: 'switch',
      ...safeErrorFields(err),
    });
  }
}

/** switch 的实际执行体（经 serializeSessionOp 按目标 sessionPath 串行）。 */
async function switchSessionImpl(
  payload: PiSessionPathPayload,
  ctx: HostActionContext | undefined,
): Promise<HostSuccess> {
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
    await commitWorkspaceCwd(payload.cwd);
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
      return switchFailure(err);
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
      await commitWorkspaceCwd(payload.cwd);
      return { success: true };
    } catch (err) {
      return switchFailure(err);
    }
  }
  // 跨项目切换：目标会话的 cwd 与当前 runtime 不同时先重建 runtime
  let before = getActiveRuntime();
  if (!before && payload.cwd) {
    const { piRuntimeApi } = await import('./pi-runtime-api');
    await piRuntimeApi.start({ cwd: payload.cwd });
    await commitWorkspaceCwd(payload.cwd);
    before = getActiveRuntime();
  }
  if (payload.cwd && before && !samePath(payload.cwd, before.cwd)) {
    const { piRuntimeApi } = await import('./pi-runtime-api');
    await piRuntimeApi.start({ cwd: payload.cwd });
    await commitWorkspaceCwd(payload.cwd);
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
    return switchFailure(err);
  }
}

export const sessionsApi = {
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSessionListResult> => {
    const cwd = await resolveCwd();
    if (!cwd) return { sessions: [] };
    const adapter = await loadPiAdapter();
    const infos = await adapter.sessions.list(cwd);
    const current = ctx?.sessionPath ?? currentSessionFile();
    const liveSessions = mergeLiveSessions(infos);
    const sessions = (
      await Promise.all(
        liveSessions.map((s) => toRowSafely(s, current, adapter.sessions, 'list')),
      )
    )
      .filter((row): row is PiSessionRow => row !== null)
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  listAll: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSessionListResult> => {
    const adapter = await loadPiAdapter();
    const infos = await adapter.sessions.listAll();
    const current = ctx?.sessionPath ?? currentSessionFile();
    const liveSessions = mergeLiveSessions(infos);
    const sessions = (
      await Promise.all(
        liveSessions.map((s) => toRowSafely(s, current, adapter.sessions, 'listAll')),
      )
    )
      .filter((row): row is PiSessionRow => row !== null)
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
    const preciseCandidates: typeof candidates = [];
    for (const candidate of candidates) {
      if (candidate.match === 'name' || !candidate.session.path) {
        preciseCandidates.push(candidate);
        continue;
      }
      try {
        const candidatePath = candidate.session.path;
        const messageTexts = branchSearchableMessages(adapter.sessions, candidatePath);
        preciseCandidates.push(searchSessions([{ ...candidate.session, messageTexts }], query, 1)[0] ?? candidate);
      } catch (err) {
        // 会话文件损坏时丢弃该候选（点开也会失败），不影响其余结果
        writePiDiagnostic({
          level: 'warning',
          event: 'session.list-entry-failed',
          module: 'sessions',
          action: 'search',
          sessionPathHash: hashSessionPath(candidate.session.path ?? ''),
          ...safeErrorFields(err),
        });
      }
    }
    const sessions = (
      await Promise.all(
        preciseCandidates
          .slice(0, limit)
          .map(async ({ session, match, snippet, messageIndex }): Promise<PiSessionSearchRow | null> => {
            const row = await toRowSafely(session, current, adapter.sessions, 'search');
            return row ? { ...row, match, snippet, messageIndex } : null;
          }),
      )
    ).filter((row): row is PiSessionSearchRow => row !== null);
    return { sessions };
  },

  switch: (payload: PiSessionPathPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    timingMark('switch:recv');
    // 以目标 sessionPath 为锁键串行：switch 有多个 await 点，并发调用会交叉
    // 改写全局 active 与窗口绑定（两个窗口同时 switch 时归属由执行顺序决定）
    return serializeSessionOp(payload.path, () => switchSessionImpl(payload, ctx));
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
      sessionMetadataCache.delete(payload.path);
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
      sessionMetadataCache.delete(payload.path);
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
      for (const session of projectSessions) {
        setArchived(session.path, payload.archived, adapter.sessions);
        sessionMetadataCache.delete(session.path);
      }
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'archive' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    sessionMetadataCache.delete(payload.path);
    const sessionPathHash = hashSessionPath(payload.path);
    // 删除后清理空目录需要知道会话属于哪个工作区（文件删除前读取）
    const sessionCwd = await sessionHeaderCwd(payload.path);
    try {
      // 任一窗口/面板打开着该会话都先切到全新会话，避免 runtime 往已删文件追加
      await detachRuntimesFromSessionFile(payload.path);
      // 对齐 pi `/resume` 的删除语义：真实应用优先移到系统废纸篓；
      // E2E 隔离目录直接删除，避免把测试会话灌进用户废纸篓。
      let method: 'trash' | 'rm' = 'trash';
      if (process.env.PI_DESKTOP_USER_DATA_DIR) {
        await rm(payload.path, { force: true });
        method = 'rm';
      } else {
        try {
          await shell.trashItem(payload.path);
        } catch (err) {
          // trashItem 失败 fallback 到永久删除：必须留痕，否则用户无从追溯
          method = 'rm';
          writePiDiagnostic({
            level: 'warning',
            event: 'session.remove.fallback',
            module: 'sessions',
            action: 'remove',
            sessionPathHash,
            detail: 'trashItem failed, permanently deleted instead',
            errorMessage: toError(err),
          });
          await rm(payload.path, { force: true });
        }
      }
      writePiDiagnostic({
        level: 'info',
        event: 'session.remove',
        module: 'sessions',
        action: 'remove',
        sessionPathHash,
        detail: `method=${method}`,
      });
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'remove' });
      // 会话目录空了就清掉：pi 的 listAll 每次都会 readdir 所有目录，
      // 空目录留着只会拖慢会话列表扫描。只在没有 runtime 把该 cwd 当工作区时
      // 清理——删除「当前打开的会话」后 runtime 的 newSession 尚未落盘新文件，
      // 目录此时为空但马上要写入，删了会让后续写文件 ENOENT。
      if (sessionCwd && !hasRuntimeWithCwd(sessionCwd)) {
        await rmdir(path.dirname(payload.path)).catch(() => {});
      }
      return { success: true };
    } catch (err) {
      writePiDiagnostic({
        level: 'error',
        event: 'session.remove.failure',
        module: 'sessions',
        action: 'remove',
        sessionPathHash,
        ...safeErrorFields(err),
      });
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
