// piSessions：会话管理。
// 列表/切换/重命名/分叉走 pi SDK（SessionManager 静态方法 + runtime.switchSession）；
// 删除 pi 无 SDK API（已确认），对齐 pi `/resume`：优先移入系统废纸篓。
// 会话替换后必须 afterSessionReplaced（重订阅 + 重绑扩展 + 推 sessionReplaced）。
import { existsSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import { sendHostEvent } from '../main/ipc/host-events';
import type {
  HostSuccess,
  PiSessionConvertToProjectPayload,
  PiSessionCwdMissingDetail,
  PiSessionExportInfo,
  PiSessionExportRecord,
  PiSessionExportResult,
  PiSessionForkResult,
  PiSessionListResult,
  PiSessionPathPayload,
  PiSessionPinPayload,
  PiSessionArchivePayload,
  PiSessionProjectArchivePayload,
  PiSessionRelocateProjectPayload,
  PiSessionRelocateProjectResult,
  PiSessionRenamePayload,
  PiSessionRow,
  PiSessionSearchPayload,
  PiSessionSearchResult,
  PiSessionSearchRow,
  PiSessionSwitchResult,
} from '@shared/host-api/contract';
import { cleanScratchpadSessionDir, ensureScratchpadSessionDir, isScratchpadPath } from '../utils/scratchpad';
import { riskyWorkspaceReason } from '../utils/workspace-safety';

import {
  afterSessionReplaced,
  activateSessionRuntime,
  awaitPendingPrewarm,
  clearPrewarmMark,
  consumePrewarmedSessionRuntime,
  contentSummaryText,
  createSessionRuntime,
  createSessionRuntimeForWindow,
  detachRuntimesFromSessionFile,
  disposeRuntime,
  getActiveRuntime,
  getLiveSessionRows,
  getRuntimeForSession,
  hasRuntimeWithCwd,
  sendRuntimeStateToWindow,
  resolveRuntimeForContext,
  isSessionRunning,
  piRuntimeApi,
} from './pi-runtime-api';
import {
  bindWindowSession,
  hasSessionInOtherWindow,
  isMainWindow,
} from '../main/window-manager';
import type { HostActionContext } from '../main/ipc/host-contract';
import { settingsApi } from './settings-api';
import { loadPiAdapter, type PiSessionCatalogPort, type PiSessionDescriptor, type PiSessionDocumentHandle } from './pi-adapter';
import { samePath, stripWindowsExtendedPrefix } from '../utils/same-path';
import { isWindowsDevicePath } from '../utils/workspace-path';
import { hashSessionPath, safeErrorFields, writePiDiagnostic } from '../utils/pi-diagnostic-log';
import { stripAttachmentEnvelope } from '@shared/message-attachments';
import { toModelUnavailableError } from '@shared/provider-error';
import {
  ensureSessionExportDirectory,
  projectFolderName,
  sessionExportPath,
  sessionExportRootDirectory,
} from '../utils/session-export';
import { getElectronStore } from '../utils/electron-store';
import { searchSessions } from './session-search';
import { serializeSessionOp } from './session-mutex';
import { timingMark } from '../utils/timing';
import {
  ARCHIVE_CUSTOM_TYPE,
  PIN_CUSTOM_TYPE,
  readSessionMetadataFlags,
} from '../utils/session-tail';

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 智能探测丢失的工作目录可能被移动到的新位置：
 * 1. 在已知其他有效会话中，匹配项目名（basename）相同且目录真实存在的有效路径；
 * 2. 如果存在当前活跃工作区（fallbackCwd），推断其同级目录：path.join(path.dirname(fallbackCwd), projectName)；
 * 3. 浅层扫描原父目录下的一级子文件夹：path.join(originalParent, subDir, projectName)。
 */
export async function probeSuggestedCwd(
  storedCwd: string,
  fallbackCwd?: string,
  knownCwds: string[] = [],
): Promise<string | undefined> {
  if (!storedCwd || typeof storedCwd !== 'string') return undefined;
  const cleanStored = stripWindowsExtendedPrefix(storedCwd.trim());
  const projectName = path.basename(cleanStored);
  if (!projectName || projectName === '/' || projectName === '.' || projectName === '\\') {
    return undefined;
  }

  const isExistingDir = async (dirPath: string): Promise<boolean> => {
    try {
      const stats = await stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  };

  // 1. 已知会话工作区匹配：在用户所有历史记录中找同名项目且目录存在的项
  const uniqueKnown = Array.from(new Set(knownCwds));
  for (const known of uniqueKnown) {
    if (!known || typeof known !== 'string') continue;
    const cleanKnown = stripWindowsExtendedPrefix(known.trim());
    if (samePath(cleanKnown, cleanStored)) continue;
    if (path.basename(cleanKnown) === projectName) {
      if (await isExistingDir(cleanKnown)) {
        return cleanKnown;
      }
    }
  }

  // 2. 启发式探测：从 fallbackCwd（例如当前打开的 .../bingking_project/FlowGate）推断
  // 同级兄弟目录 .../bingking_project/pi-desktop
  if (fallbackCwd && typeof fallbackCwd === 'string') {
    const cleanFallback = stripWindowsExtendedPrefix(fallbackCwd.trim());
    const parent = path.dirname(cleanFallback);
    const candidate = path.join(parent, projectName);
    if (!samePath(candidate, cleanStored) && await isExistingDir(candidate)) {
      return candidate;
    }
  }

  // 3. 原父目录的子目录探测（例如 ~/Desktop/*/pi-desktop）
  try {
    const originalParent = path.dirname(cleanStored);
    const entries = await readdir(originalParent, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(originalParent, entry.name, projectName);
        if (!samePath(candidate, cleanStored) && await isExistingDir(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // 忽略目录不可读
  }

  return undefined;
}

async function toSessionCwdMissingResult(
  err: unknown,
  fallbackCwd?: string,
  sessionCount?: number,
  detectedCwd?: string,
): Promise<PiSessionCwdMissingDetail | null> {
  const name = (err as { name?: string })?.name;
  const message = toError(err);
  const isMissingCwd =
    name === 'MissingSessionCwdError' ||
    message.startsWith('Stored session working directory does not exist');
  if (!isMissingCwd) return null;

  const issue = (err as { issue?: { sessionCwd?: string; fallbackCwd?: string } })?.issue;
  let sessionCwd = issue?.sessionCwd;
  let detectedFallback = issue?.fallbackCwd ?? fallbackCwd;

  if (!sessionCwd) {
    const match = /Stored session working directory does not exist:\s*(.+?)(?:\r?\n|$)/.exec(message);
    if (match) sessionCwd = match[1].trim();
  }
  if (!detectedFallback) {
    const match = /Current working directory:\s*(.+?)(?:\r?\n|$)/.exec(message);
    if (match) detectedFallback = match[1].trim();
  }

  let finalCount = sessionCount;
  let finalDetected = detectedCwd;

  if (sessionCwd && (finalCount === undefined || finalDetected === undefined)) {
    try {
      const adapter = await loadPiAdapter();
      const allSessions = await getCachedOrFetchListAll(adapter.sessions);
      if (finalCount === undefined) {
        finalCount = allSessions.filter((s) => samePath(s.cwd, sessionCwd)).length;
      }
      if (finalDetected === undefined) {
        finalDetected = await probeSuggestedCwd(sessionCwd, detectedFallback, allSessions.map((s) => s.cwd));
      }
    } catch {
      // 容忍探测与计数异常
    }
  }

  return {
    sessionCwd: sessionCwd ?? '',
    fallbackCwd: detectedFallback ?? fallbackCwd ?? '',
    ...(typeof finalCount === 'number' && finalCount > 0 ? { sessionCount: finalCount } : {}),
    ...(finalDetected ? { detectedCwd: finalDetected } : {}),
  };
}

/**
 * 当带 cwdOverride 成功打开/切换会话时，安全改写 jsonl header 的 cwd，
 * 避免后续再次打开该会话时反复提示工作目录丢失。
 */
export async function updateSessionHeaderCwd(sessionPath: string, newCwd: string): Promise<void> {
  try {
    const content = await readFile(sessionPath, 'utf8');
    const firstNewline = content.indexOf('\n');
    const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
    if (!firstLine.trim()) return;
    const header = JSON.parse(firstLine) as { type?: string; cwd?: string; [key: string]: unknown };
    if (header.type !== 'session' || (typeof header.cwd === 'string' && samePath(header.cwd, newCwd))) return;

    header.cwd = newCwd;
    const newFirstLine = JSON.stringify(header);
    const updatedContent =
      firstNewline === -1
        ? `${newFirstLine}\n`
        : `${newFirstLine}\n${content.slice(firstNewline + 1)}`;
    const tempFile = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempFile, updatedContent, 'utf8');
      await rename(tempFile, sessionPath);
    } finally {
      await rm(tempFile, { force: true }).catch(() => {});
    }
    invalidateSessionMetadata(sessionPath);
  } catch (err) {
    writePiDiagnostic({
      level: 'warning',
      event: 'session.header-cwd-update-failed',
      module: 'sessions',
      action: 'updateSessionHeaderCwd',
      sessionPathHash: hashSessionPath(sessionPath),
      ...safeErrorFields(err),
    });
  }
}

/**
 * switch 失败的统一出口：模型不可用时抛 MODEL_UNAVAILABLE HostError；
 * 会话记录的工作目录不存在时返回 SESSION_CWD_MISSING 结构化错误供前端确认恢复；
 * 其余错误维持 success:false 返回。
 */
async function switchFailure(err: unknown, fallbackCwd?: string): Promise<PiSessionSwitchResult> {
  const message = toError(err);
  const modelError = toModelUnavailableError(message);
  if (modelError) throw modelError;

  const cwdMissing = await toSessionCwdMissingResult(err, fallbackCwd);
  if (cwdMissing) {
    return {
      success: false,
      error: message,
      errorCode: 'SESSION_CWD_MISSING',
      detail: cwdMissing,
    };
  }

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

type SessionMetadataCacheEntry = {
  mtimeMs: number;
  size: number;
  archived: boolean;
  pinned: boolean;
};

export const sessionMetadataCache = new Map<string, SessionMetadataCacheEntry>();

export function clearSessionMetadataCache(): void {
  sessionMetadataCache.clear();
  invalidateSessionListCache();
}

export function invalidateSessionMetadata(targetPath: string): void {
  sessionMetadataCache.delete(targetPath);
  for (const key of sessionMetadataCache.keys()) {
    if (samePath(key, targetPath)) {
      sessionMetadataCache.delete(key);
    }
  }
  invalidateSessionListCache();
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

function isPinnedForActive(
  active: NonNullable<ReturnType<typeof getActiveRuntime>>,
  sessions: PiSessionCatalogPort,
): boolean {
  const entries = sessions.getEntries(active.adapterRuntime.session.view.sessionManager);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: string; customType?: string; data?: { pinned?: unknown } };
    if (entry.type === 'custom' && entry.customType === PIN_CUSTOM_TYPE) {
      return entry.data?.pinned === true;
    }
  }
  return false;
}

async function resolveMetadataFlags(
  sessionPath: string,
  sessions: PiSessionCatalogPort,
): Promise<{ archived: boolean; pinned: boolean }> {
  const active = getActiveRuntime();
  if (active && samePath(sessionPath, active.adapterRuntime.session.view.sessionFile)) {
    return {
      archived: isArchivedForActive(active, sessions),
      pinned: isPinnedForActive(active, sessions),
    };
  }

  try {
    const fileStat = await stat(sessionPath);
    const cached = sessionMetadataCache.get(sessionPath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return { archived: cached.archived, pinned: cached.pinned };
    }
    const flags = await readSessionMetadataFlags(sessionPath);
    sessionMetadataCache.set(sessionPath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      archived: flags.archived,
      pinned: flags.pinned,
    });
    return flags;
  } catch {
    return { archived: false, pinned: false };
  }
}

function setArchived(path: string, archived: boolean, sessions: PiSessionCatalogPort): void {
  sessions.appendCustomEntry(sessionManagerFor(path, sessions), ARCHIVE_CUSTOM_TYPE, { archived });
}

function setPinned(path: string, pinned: boolean, sessions: PiSessionCatalogPort): void {
  sessions.appendCustomEntry(sessionManagerFor(path, sessions), PIN_CUSTOM_TYPE, { pinned });
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

type BranchMessagesCacheEntry = {
  mtimeMs: number;
  size: number;
  texts: string[];
};

const branchMessagesCache = new Map<string, BranchMessagesCacheEntry>();

export function getCachedBranchSearchableMessages(sessions: PiSessionCatalogPort, sessionPath: string): string[] {
  try {
    const stats = statSync(sessionPath);
    const cached = branchMessagesCache.get(sessionPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.texts;
    }
    const texts = branchSearchableMessages(sessions, sessionPath);
    branchMessagesCache.set(sessionPath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      texts,
    });
    if (branchMessagesCache.size > 500) {
      const oldestKey = branchMessagesCache.keys().next().value;
      if (oldestKey) branchMessagesCache.delete(oldestKey);
    }
    return texts;
  } catch {
    return branchSearchableMessages(sessions, sessionPath);
  }
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
}, current: string | undefined, archived: boolean, pinned: boolean, cwdExists?: boolean): PiSessionRow {
  // 附件 XML 信封不属于标题文字：name/firstMessage 都可能带（pi 按首条消息自动命名时），
  // 列表出口统一剥离，历史脏标题在展示层一并清净
  const cleanName = s.name ? stripAttachmentEnvelope(s.name) : '';
  return {
    path: s.path,
    id: s.id,
    cwd: s.cwd,
    cwdExists,
    name: cleanName || undefined,
    firstMessage: stripAttachmentEnvelope(s.firstMessage),
    messageCount: s.messageCount,
    created: s.created.toISOString(),
    modified: s.modified.toISOString(),
    isCurrent: samePath(s.path, current),
    isRunning: isSessionRunning(s.path),
    archived,
    pinned,
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
  cwdExistsCache?: Map<string, boolean>,
): Promise<PiSessionRow | null> {
  try {
    const flags = await resolveMetadataFlags(session.path, sessions);
    let cwdExists: boolean | undefined;
    if (session.cwd) {
      if (cwdExistsCache) {
        if (!cwdExistsCache.has(session.cwd)) {
          cwdExistsCache.set(session.cwd, existsSync(session.cwd));
        }
        cwdExists = cwdExistsCache.get(session.cwd);
      } else {
        cwdExists = existsSync(session.cwd);
      }
    }
    return toRow(session, current, flags.archived, flags.pinned, cwdExists);
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
function isScratchpadCwd(cwd?: string | null): boolean {
  if (!cwd) return false;
  const normalized = cwd.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/.pi/scratchpad');
}

async function switchSessionImpl(
  payload: PiSessionPathPayload,
  ctx: HostActionContext | undefined,
): Promise<PiSessionSwitchResult> {
  const targetFile = stripWindowsExtendedPrefix(path.resolve(payload.path));
  if (!existsSync(targetFile)) {
    return { success: false, error: 'session file does not exist' };
  }

  const storedCwd = payload.cwd ?? (await sessionHeaderCwd(payload.path));
  const currentRuntime = getActiveRuntime();
  let fallbackCwd = currentRuntime?.cwd ?? process.cwd();
  if (!existsSync(fallbackCwd) || isScratchpadCwd(fallbackCwd)) {
    const configuredWorkspace = await settingsApi.get({ key: 'workspaceCwd' });
    if (configuredWorkspace && typeof configuredWorkspace === 'string' && existsSync(configuredWorkspace)) {
      fallbackCwd = configuredWorkspace;
    }
  }

  // 若没有提供 cwdOverride，且会话记录的 cwd 不存在，直接返回 SESSION_CWD_MISSING
  if (!payload.cwdOverride && storedCwd && !existsSync(storedCwd)) {
    let sessionCount: number | undefined;
    let detectedCwd: string | undefined;
    try {
      const adapter = await loadPiAdapter();
      const allSessions = await getCachedOrFetchListAll(adapter.sessions);
      sessionCount = allSessions.filter((s) => samePath(s.cwd, storedCwd)).length;
      detectedCwd = await probeSuggestedCwd(storedCwd, fallbackCwd, allSessions.map((s) => s.cwd));
    } catch {
      // 统计会话数/探测失败不影响主流程，留给前端回退展示
    }
    return {
      success: false,
      error: `Stored session working directory does not exist: ${storedCwd}`,
      errorCode: 'SESSION_CWD_MISSING',
      detail: {
        sessionCwd: storedCwd,
        fallbackCwd,
        ...(typeof sessionCount === 'number' && sessionCount > 0 ? { sessionCount } : {}),
        ...(detectedCwd ? { detectedCwd } : {}),
      },
    };
  }

  const targetCwd = payload.cwdOverride ?? payload.cwd;
  const activeForCheck = getActiveRuntime();
  const boundToActive = Boolean(
    ctx?.sessionPath
    && activeForCheck?.adapterRuntime.session.view.sessionFile
    && samePath(ctx.sessionPath, activeForCheck.adapterRuntime.session.view.sessionFile),
  );
  // 独立窗口 attach：优先消费 openDetached 的预热产物（在途等完成），
  // 按 attach 语义绑定（activate=false 建出来的，不挤占全局 active）
  if (ctx?.sessionPath && !boundToActive && targetCwd
    && await consumePrewarmedSessionRuntime(payload.path)) {
    timingMark('switch:prewarm-hit');
    bindSenderWindow(ctx, payload.path);
    if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
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
    if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
    await commitWorkspaceCwd(targetCwd);
    return { success: true };
  }
  // 调用方窗口绑定着非活动会话（独立窗口 attach/切会话）时，
  // 为目标会话单独建保活 runtime，不挤占全局 active（主窗口）的运行时。
  if (ctx?.sessionPath && !boundToActive && targetCwd) {
    try {
      timingMark('switch:create-runtime:start');
      await createSessionRuntime(targetCwd, payload.path, {
        activate: false,
        cwdOverride: payload.cwdOverride,
      });
      timingMark('switch:create-runtime:done');
      bindSenderWindow(ctx, payload.path);
      if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
      return { success: true };
    } catch (err) {
      return await switchFailure(err, targetCwd);
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
      await createSessionRuntimeForWindow(targetCwd ?? current.cwd, payload.path, ctx, {
        cwdOverride: payload.cwdOverride,
      });
      if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
      await commitWorkspaceCwd(targetCwd);
      return { success: true };
    } catch (err) {
      return await switchFailure(err, targetCwd ?? current.cwd);
    }
  }
  // 跨项目切换：目标会话的 cwd 与当前 runtime 不同时先重建 runtime
  try {
    let before = getActiveRuntime();
    if (!before && targetCwd) {
      await piRuntimeApi.start({ cwd: targetCwd });
      await commitWorkspaceCwd(targetCwd);
      before = getActiveRuntime();
    }
    if (targetCwd && before && !samePath(targetCwd, before.cwd)) {
      await piRuntimeApi.start({ cwd: targetCwd });
      await commitWorkspaceCwd(targetCwd);
    }
  } catch (err) {
    return await switchFailure(err, fallbackCwd);
  }
  const active = getActiveRuntime();
  if (!active) return { success: false, error: 'session not started' };
  if (samePath(payload.path, currentSessionFile())) {
    bindSenderWindow(ctx, payload.path);
    if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
    return { success: true };
  }
  try {
    if (active.adapterRuntime.session.view.isStreaming) {
      await createSessionRuntime(targetCwd ?? active.cwd, payload.path, {
        cwdOverride: payload.cwdOverride,
      });
      bindSenderWindow(ctx, payload.path);
      if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
      return { success: true };
    }
    const result = await active.adapterRuntime.switchSession(
      payload.path,
      payload.cwdOverride ? { cwdOverride: payload.cwdOverride } : undefined,
    );
    if (result.cancelled) return { success: false, error: 'cancelled' };
    await afterSessionReplaced(active, ctx);
    bindSenderWindow(ctx, payload.path);
    if (payload.cwdOverride) await updateSessionHeaderCwd(payload.path, payload.cwdOverride);
    return { success: true };
  } catch (err) {
    return await switchFailure(err, targetCwd ?? active.cwd);
  }
}

let inFlightListAll: Promise<PiSessionDescriptor[]> | null = null;
let listAllCache: { timestamp: number; infos: PiSessionDescriptor[] } | null = null;
const LIST_ALL_CACHE_TTL_MS = 3_000;

export function invalidateSessionListCache(): void {
  listAllCache = null;
}

async function getCachedOrFetchListAll(sessions: PiSessionCatalogPort): Promise<PiSessionDescriptor[]> {
  const now = Date.now();
  if (listAllCache && now - listAllCache.timestamp < LIST_ALL_CACHE_TTL_MS) {
    return listAllCache.infos;
  }
  if (inFlightListAll) {
    return inFlightListAll;
  }
  inFlightListAll = (async () => {
    try {
      const infos = await sessions.listAll();
      listAllCache = { timestamp: Date.now(), infos };
      return infos;
    } finally {
      inFlightListAll = null;
    }
  })();
  return inFlightListAll;
}

export const sessionsApi = {
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSessionListResult> => {
    const cwd = await resolveCwd();
    if (!cwd) return { sessions: [] };
    const adapter = await loadPiAdapter();
    const infos = await adapter.sessions.list(cwd);
    const current = ctx?.sessionPath ?? currentSessionFile();
    const liveSessions = mergeLiveSessions(infos);
    const cwdExistsCache = new Map<string, boolean>();
    const sessions = (
      await Promise.all(
        liveSessions.map((s) => toRowSafely(s, current, adapter.sessions, 'list', cwdExistsCache)),
      )
    )
      .filter((row): row is PiSessionRow => row !== null && row.messageCount > 0)
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  listAll: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSessionListResult> => {
    const adapter = await loadPiAdapter();
    const infos = await getCachedOrFetchListAll(adapter.sessions);
    const current = ctx?.sessionPath ?? currentSessionFile();
    const liveSessions = mergeLiveSessions(infos);
    const cwdExistsCache = new Map<string, boolean>();
    const sessions = (
      await Promise.all(
        liveSessions.map((s) => toRowSafely(s, current, adapter.sessions, 'listAll', cwdExistsCache)),
      )
    )
      .filter((row): row is PiSessionRow => row !== null && row.messageCount > 0)
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { sessions };
  },

  search: async (payload: PiSessionSearchPayload, ctx?: HostActionContext): Promise<PiSessionSearchResult> => {
    const query = (payload?.query ?? '').trim();
    if (!query) return { sessions: [] };
    const adapter = await loadPiAdapter();
    const rawInfos = await getCachedOrFetchListAll(adapter.sessions);
    const infos = rawInfos.filter((info) => info.messageCount > 0);
    const current = ctx?.sessionPath ?? currentSessionFile();
    const limit = Number.isFinite(payload?.limit) ? Math.max(1, Math.min(Math.floor(payload!.limit!), 100)) : 50;
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
        const messageTexts = getCachedBranchSearchableMessages(adapter.sessions, candidatePath);
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

  switch: (payload: PiSessionPathPayload, ctx?: HostActionContext): Promise<PiSessionSwitchResult> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return Promise.resolve({ success: false, error: 'invalid session path' });
    }
    const cleanPath = stripWindowsExtendedPrefix(payload.path.trim());
    if (isWindowsDevicePath(cleanPath)) {
      return Promise.resolve({ success: false, error: 'device paths are not allowed' });
    }
    if (payload.cwdOverride && isWindowsDevicePath(stripWindowsExtendedPrefix(payload.cwdOverride))) {
      return Promise.resolve({ success: false, error: 'device paths are not allowed' });
    }
    timingMark('switch:recv');
    // 以目标 sessionPath 为锁键串行：switch 有多个 await 点，并发调用会交叉
    // 改写全局 active 与窗口绑定（两个窗口同时 switch 时归属由执行顺序决定）
    return serializeSessionOp(payload.path, () => switchSessionImpl(payload, ctx));
  },

  rename: async (payload: PiSessionRenamePayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return { success: false, error: 'invalid session path' };
    }
    if (isWindowsDevicePath(payload.path.trim())) {
      return { success: false, error: 'device paths are not allowed' };
    }
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (!name) return { success: false, error: 'empty name' };
    try {
      const active = resolveRuntimeForContext(ctx) ?? getActiveRuntime();
      const adapter = await loadPiAdapter();
      if (active && samePath(payload.path, active.adapterRuntime.session.view.sessionFile)) {
        adapter.sessions.appendSessionInfo(active.adapterRuntime.session.view.sessionManager, name);
      } else {
        adapter.sessions.appendSessionInfo(adapter.sessions.open(payload.path), name);
      }
      invalidateSessionMetadata(payload.path);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'rename' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  fork: async (payload: PiSessionPathPayload, ctx?: HostActionContext): Promise<PiSessionForkResult> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return { success: false, error: 'invalid session path' };
    }
    if (isWindowsDevicePath(payload.path.trim())) {
      return { success: false, error: 'device paths are not allowed' };
    }
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    const active = resolveRuntimeForContext(ctx) ?? getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    try {
      const adapter = await loadPiAdapter();
      const forked = adapter.sessions.forkFrom(payload.path, active.cwd);
      const newPath = forked.path;
      if (!newPath) return { success: false, error: 'fork produced no session file' };
      const result = await active.adapterRuntime.switchSession(newPath);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      await afterSessionReplaced(active, ctx);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'fork' });
      return { success: true, path: newPath };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  archive: async (payload: PiSessionArchivePayload): Promise<HostSuccess> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return { success: false, error: 'invalid session path' };
    }
    if (isWindowsDevicePath(payload.path.trim())) {
      return { success: false, error: 'device paths are not allowed' };
    }
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    try {
      const adapter = await loadPiAdapter();
      setArchived(payload.path, payload.archived, adapter.sessions);
      invalidateSessionMetadata(payload.path);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'archive' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  pin: async (payload: PiSessionPinPayload): Promise<HostSuccess> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return { success: false, error: 'invalid session path' };
    }
    if (isWindowsDevicePath(payload.path.trim())) {
      return { success: false, error: 'device paths are not allowed' };
    }
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    try {
      const adapter = await loadPiAdapter();
      setPinned(payload.path, payload.pinned, adapter.sessions);
      invalidateSessionMetadata(payload.path);
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'pin' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  archiveProject: async (payload: PiSessionProjectArchivePayload): Promise<HostSuccess> => {
    if (!payload?.cwd || typeof payload.cwd !== 'string' || !payload.cwd.trim()) {
      return { success: false, error: 'invalid workspace path' };
    }
    const cleanCwd = stripWindowsExtendedPrefix(payload.cwd.trim());
    if (isWindowsDevicePath(cleanCwd)) {
      return { success: false, error: 'device paths are not allowed' };
    }
    try {
      const adapter = await loadPiAdapter();
      const allInfos = await getCachedOrFetchListAll(adapter.sessions);
      const liveSessions = mergeLiveSessions(allInfos);
      const projectSessions = liveSessions.filter(
        (session) => samePath(session.cwd, cleanCwd) && session.messageCount > 0,
      );
      if (projectSessions.some((session) => isSessionRunning(session.path))) {
        return { success: false, error: 'project has a running session' };
      }
      for (const session of projectSessions) {
        setArchived(session.path, payload.archived, adapter.sessions);
        invalidateSessionMetadata(session.path);
      }
      invalidateSessionListCache();
      sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'archive' });
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiSessionPathPayload): Promise<HostSuccess> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return { success: false, error: 'invalid session path' };
    }
    const cleanPath = stripWindowsExtendedPrefix(payload.path.trim());
    if (isWindowsDevicePath(cleanPath)) {
      return { success: false, error: 'device paths are not allowed' };
    }
    const targetFile = stripWindowsExtendedPrefix(path.resolve(cleanPath));
    if (existsSync(targetFile)) {
      try {
        if (statSync(targetFile).isDirectory()) {
          return { success: false, error: 'session path cannot be a directory' };
        }
      } catch {
        // ignore
      }
    }
    if (isSessionRunning(payload.path)) return { success: false, error: 'session is running' };
    invalidateSessionMetadata(payload.path);
    const sessionPathHash = hashSessionPath(payload.path);
    // 删除后清理空目录需要知道会话属于哪个工作区（文件删除前读取）
    const sessionCwd = await sessionHeaderCwd(payload.path);
    try {
      // 任一窗口/面板打开着该会话都先切到全新会话，避免 runtime 往已删文件追加
      await detachRuntimesFromSessionFile(payload.path);
      // 对齐 pi `/resume` 的删除语义：真实应用优先移到系统废纸篓；
      // E2E 隔离目录直接删除，避免把测试会话灌进用户废纸篓。
      let method: 'trash' | 'rm' = 'trash';
      if (!existsSync(targetFile)) {
        method = 'rm';
      } else if (process.env.PI_DESKTOP_USER_DATA_DIR) {
        await rm(targetFile, { force: true });
        method = 'rm';
      } else {
        try {
          await shell.trashItem(targetFile);
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
          await rm(targetFile, { force: true });
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
        await rmdir(path.dirname(targetFile)).catch(() => {});
      }

      // 清理会话对应的导出记录索引
      try {
        const store = await getElectronStore();
        const records = (store.get('sessionExportRecords') ?? {}) as Record<string, PiSessionExportRecord>;
        let modified = false;
        for (const key of Object.keys(records)) {
          if (samePath(key, payload.path)) {
            delete records[key];
            modified = true;
          }
        }
        if (modified) {
          store.set('sessionExportRecords', records);
        }
      } catch {}
      if (sessionCwd && isScratchpadPath(sessionCwd)) {
        await cleanScratchpadSessionDir(sessionCwd);
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

  exportHtml: async (payload: PiSessionPathPayload, ctx?: HostActionContext): Promise<PiSessionExportResult> => {
    if (!payload?.path || typeof payload.path !== 'string' || !payload.path.trim()) {
      return { success: false, error: 'invalid session path' };
    }
    const rawPath = payload.path.trim();
    if (['__proto__', 'constructor', 'prototype'].includes(rawPath)) {
      return { success: false, error: 'invalid session path' };
    }
    const cleanPath = stripWindowsExtendedPrefix(rawPath);
    if (isWindowsDevicePath(cleanPath)) {
      return { success: false, error: 'device paths are not allowed' };
    }
    const active = resolveRuntimeForContext(ctx) ?? getActiveRuntime();
    if (!active) return { success: false, error: 'session not started' };
    try {
      // exportToHtml 挂在 AgentSession 上，只能导「当前会话」；目标不是当前会话时先切过去。
      if (!samePath(payload.path, active.adapterRuntime.session.view.sessionFile)) {
        const result = await active.adapterRuntime.switchSession(payload.path);
        if (result.cancelled) return { success: false, error: 'cancelled' };
        await afterSessionReplaced(active, ctx);
      }

      const session = active.adapterRuntime.session;
      const cwd = payload.cwd ?? session.sessionManager.getCwd() ?? active.cwd;
      const messages = session.messages as Array<{ role?: string; content?: unknown }>;
      const firstUser = messages.find((m) => m.role === 'user');
      const title = payload.title
        ?? session.sessionManager.getSessionName()
        ?? contentSummaryText(firstUser?.content)
        ?? 'untitled';
      const sessionId = payload.id ?? session.sessionId;

      const target = await sessionExportPath({
        sessionFile: payload.path,
        cwd,
        title,
        id: sessionId,
      });
      const exported = await session.exportToHtml(target);
      const projectName = projectFolderName(cwd);

      const record: PiSessionExportRecord = {
        path: exported,
        sessionPath: payload.path,
        sessionId,
        projectName,
        cwd,
        title: stripAttachmentEnvelope(title),
        exportedAt: new Date().toISOString(),
      };

      const store = await getElectronStore();
      const records = (store.get('sessionExportRecords') ?? {}) as Record<string, PiSessionExportRecord>;
      if (!['__proto__', 'constructor', 'prototype'].includes(payload.path)) {
        records[payload.path] = record;
        store.set('sessionExportRecords', records);
      }
      store.set('lastSessionExportRecord', record);
      await settingsApi.set({ key: 'lastSessionExportPath', value: exported });

      return { success: true, path: exported, record };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  getExportInfo: async (): Promise<PiSessionExportInfo> => {
    const directory = sessionExportRootDirectory();
    const lastPath = await settingsApi.get({ key: 'lastSessionExportPath' });
    const store = await getElectronStore();
    const lastRecord = store.get('lastSessionExportRecord') as PiSessionExportRecord | undefined;
    const rawRecords = (store.get('sessionExportRecords') ?? {}) as Record<string, PiSessionExportRecord>;

    const validRecords: Record<string, PiSessionExportRecord> = {};
    let recordsModified = false;
    for (const [key, rec] of Object.entries(rawRecords)) {
      if (rec?.path && existsSync(rec.path)) {
        validRecords[key] = rec;
      } else {
        recordsModified = true;
      }
    }
    if (recordsModified) {
      store.set('sessionExportRecords', validRecords);
    }

    const sortedRecords = Object.values(validRecords).sort((a, b) => {
      const timeA = a.exportedAt ? new Date(a.exportedAt).getTime() : 0;
      const timeB = b.exportedAt ? new Date(b.exportedAt).getTime() : 0;
      return timeB - timeA;
    });
    const recentRecords = sortedRecords.slice(0, 5);
    const validLastRecord = recentRecords[0] ?? (lastRecord?.path && existsSync(lastRecord.path) ? lastRecord : undefined);

    if (validLastRecord) {
      store.set('lastSessionExportRecord', validLastRecord);
      await settingsApi.set({ key: 'lastSessionExportPath', value: validLastRecord.path });
    } else {
      store.delete('lastSessionExportRecord');
      store.delete('lastSessionExportPath');
    }

    const validLastPath = validLastRecord?.path ?? (lastPath && existsSync(lastPath) ? lastPath : undefined);

    return {
      directory,
      lastPath: validLastPath,
      lastRecord: validLastRecord,
      recentRecords,
      records: validRecords,
    };
  },

  convertToProject: async (
    payload: PiSessionConvertToProjectPayload,
    ctx?: HostActionContext,
  ): Promise<HostSuccess> => {
    if (!payload?.sessionPath || !payload?.targetCwd) {
      return { success: false, error: 'invalid session path or target cwd' };
    }
    const targetCwd = stripWindowsExtendedPrefix(payload.targetCwd.trim());
    if (isWindowsDevicePath(targetCwd)) {
      return { success: false, error: 'device paths are not allowed' };
    }
    const risky = riskyWorkspaceReason(targetCwd);
    if (risky) {
      return { success: false, error: `risky-workspace-${risky}` };
    }
    const sourceSessionFile = stripWindowsExtendedPrefix(path.resolve(payload.sessionPath));
    if (!existsSync(sourceSessionFile)) {
      return { success: false, error: 'session file not found' };
    }
    await mkdir(targetCwd, { recursive: true });

    // 1. 读取原会话的 cwd
    const originCwd = await sessionHeaderCwd(sourceSessionFile);

    // 2. 如果原 cwd 是 scratchpad 沙箱，把沙箱内的代码文件拷贝到 targetCwd
    if (originCwd && isScratchpadPath(originCwd) && existsSync(originCwd)) {
      try {
        const entries = await readdir(originCwd, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.gitignore' || entry.name === 'node_modules') continue;
          const srcPath = path.join(originCwd, entry.name);
          const destPath = path.join(targetCwd, entry.name);
          await cp(srcPath, destPath, { recursive: true, force: false }).catch(() => {});
        }
      } catch {
        // ignore copy errors
      }
    }

    // 3. 更新 session 文件 header 的 cwd
    await updateSessionHeaderCwd(sourceSessionFile, targetCwd);

    // 4. 持久化 workspaceCwd
    await commitWorkspaceCwd(targetCwd);

    // 5. 若原会话在内存中已有绑定在旧沙箱的 live runtime，将其释放以强制按 targetCwd 重建
    const existingRuntime = getRuntimeForSession(sourceSessionFile);
    if (existingRuntime) {
      disposeRuntime(existingRuntime);
    }

    // 6. 重新 switch 到该会话与新目录
    const switchRes = await serializeSessionOp(sourceSessionFile, () =>
      switchSessionImpl({ path: sourceSessionFile, cwd: targetCwd }, ctx),
    );
    if (!switchRes.success) {
      return switchRes;
    }

    sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'convertToProject' });
    return { success: true };
  },

  getScratchpadDir: async (): Promise<{ dir: string }> => {
    const sessionKey = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = await ensureScratchpadSessionDir(sessionKey);
    return { dir };
  },

  relocateProject: async (
    payload: PiSessionRelocateProjectPayload,
    _ctx?: HostActionContext,
  ): Promise<PiSessionRelocateProjectResult> => {
    if (!payload?.oldCwd || !payload?.newCwd) {
      return { success: false, error: 'invalid oldCwd or newCwd' };
    }
    const oldCwd = stripWindowsExtendedPrefix(payload.oldCwd.trim());
    const newCwd = stripWindowsExtendedPrefix(payload.newCwd.trim());
    if (isWindowsDevicePath(oldCwd) || isWindowsDevicePath(newCwd)) {
      return { success: false, error: 'device paths are not allowed' };
    }
    const risky = riskyWorkspaceReason(newCwd);
    if (risky) {
      return { success: false, error: `risky-workspace-${risky}` };
    }
    if (!existsSync(newCwd)) {
      return { success: false, error: 'target directory does not exist' };
    }
    if (samePath(oldCwd, newCwd)) {
      return { success: true, count: 0 };
    }

    const adapter = await loadPiAdapter();
    const allInfos = await getCachedOrFetchListAll(adapter.sessions);
    const matchingSessions = allInfos.filter((s) => samePath(s.cwd, oldCwd));

    // 检查是否有任何属于该工作区的会话正在运行
    for (const session of matchingSessions) {
      if (isSessionRunning(session.path)) {
        return { success: false, error: 'session is running' };
      }
    }

    // 释放内存中绑在旧工作区路径上的空闲 runtime（确保切入时按 newCwd 重建）
    for (const session of matchingSessions) {
      const live = getRuntimeForSession(session.path);
      if (live) {
        disposeRuntime(live);
      }
    }

    let targetSessionDir: string | undefined;
    try {
      targetSessionDir = adapter.sessions.getSessionDir?.(newCwd);
    } catch {
      // ignore
    }
    if (targetSessionDir) {
      await mkdir(targetSessionDir, { recursive: true }).catch(() => {});
    }

    const movedPaths: Record<string, string> = {};
    const oldDirsToCheck = new Set<string>();

    for (const session of matchingSessions) {
      const sourceFile = session.path;
      if (!existsSync(sourceFile)) continue;

      // 1. 安全改写会话文件的 header cwd
      await updateSessionHeaderCwd(sourceFile, newCwd);

      // 2. 若 pi session 目录不同，将 session 文件迁移到对应的目录中
      if (targetSessionDir) {
        const currentDir = path.dirname(sourceFile);
        if (!samePath(currentDir, targetSessionDir)) {
          oldDirsToCheck.add(currentDir);
          const targetFile = path.join(targetSessionDir, path.basename(sourceFile));
          if (!samePath(sourceFile, targetFile)) {
            try {
              await rename(sourceFile, targetFile);
              movedPaths[sourceFile] = targetFile;
              invalidateSessionMetadata(sourceFile);
              invalidateSessionMetadata(targetFile);
            } catch (err) {
              writePiDiagnostic({
                level: 'warning',
                event: 'session.relocate-file-move-failed',
                module: 'sessions',
                action: 'relocateProject',
                sessionPathHash: hashSessionPath(sourceFile),
                ...safeErrorFields(err),
              });
            }
          }
        }
      }
    }

    // 3. 清理已变为空目录的旧 pi session 文件夹
    for (const oldDir of oldDirsToCheck) {
      try {
        const files = await readdir(oldDir);
        if (files.length === 0) {
          await rmdir(oldDir).catch(() => {});
        }
      } catch {
        // ignore
      }
    }

    // 4. 若全局记录的当前工作区也是该旧路径，自动同步为新工作区
    const currentWorkspaceCwd = await settingsApi.get({ key: 'workspaceCwd' });
    if (currentWorkspaceCwd && samePath(String(currentWorkspaceCwd), oldCwd)) {
      await commitWorkspaceCwd(newCwd);
    }

    // 5. 清除缓存并通知渲染层
    clearSessionMetadataCache();
    sendHostEvent('piRuntime', 'sessionsChanged', { reason: 'relocateProject' });

    return {
      success: true,
      count: matchingSessions.length,
      newSessionDir: targetSessionDir,
      movedPaths,
    };
  },
};
