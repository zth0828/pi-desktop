// pi 会话运行时：壳与 pi SDK 的唯一接触面之一（会话生命周期 + 事件桥）。
// 事件映射在 shared/pi-event-map.ts（单点）。会话替换（new/switch/fork）后
// 必须重新 subscribe + bindExtensions（SDK 约定）。
import {
  mapPiSessionEvent,
  type PiEventDropCallback,
  type PiRuntimeEventEnvelope,
} from '@shared/pi-event-map';
import { DEFAULT_CONTEXT_WINDOW } from '@shared/host-api/contract';
import type {
  PiRuntimePromptPayload,
  PiRuntimeStartPayload,
  PiRuntimeStateResult,
  PiRuntimeContextUsage,
  PiRuntimeModelInfo,
  PiRuntimeModelUpdateResult,
  PiRuntimeUsageResult,
  PiRuntimeUsageTurn,
  PiRuntimeForkPayload,
  PiRuntimeForkResult,
  PiRuntimeNewSessionPayload,
  PiRuntimeTreeNode,
  PiRuntimeTreeResult,
  PiRuntimeNavigatePayload,
  PiRuntimeNavigateResult,
  PiRuntimeCompactPayload,
  PiRuntimeExportPayload,
  PiRuntimeSessionInfo,
  PiSessionExportResult,
  PiUiResponsePayload,
  PiRuntimeQueueItemPayload,
  PiRuntimeBashPayload,
  PiPromptLifecyclePhase,
} from '@shared/host-api/contract';
import { stripAttachmentEnvelope } from '@shared/message-attachments';
import { toModelUnavailableError } from '@shared/provider-error';
import type {
  PiEventBusPort,
  PiRuntimeHandle,
  PiSessionEntry,
  PiSessionPort,
  PiSessionTreeNode,
  PiSettingsHandle,
} from './pi-adapter';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { sendHostEvent, sendHostEventToWebContents } from '../main/ipc/host-events';
import type { HostActionContext } from '../main/ipc/host-contract';
import {
  bindWindowSession,
  findWindowBySession,
  hasSessionInOtherWindow,
  isMainWindow,
  rebindWindowSession,
  rebindWindowSessionForWindow,
} from '../main/window-manager';
import { expandFileReferences } from '../utils/file-expand';
import { samePath } from '../utils/same-path';
import {
  normalizePreviewablePath,
  previewableExternalFilesFromMessages,
} from '../utils/previewable-files';
import { syncLmStudioModels } from '../utils/lmstudio-models';
import { sessionExportPath } from '../utils/session-export';
import {
  cancelPendingUiForContext,
  createExtensionUIContext,
  getExtensionUiStateSnapshot,
  getPendingUiRequests,
  resetExtensionUiState,
  resolveUiResponse,
} from './extension-ui';
import { captureReviewBaseline, clearReviewBaseline } from './review-api';
import { noteRunEnded, noteRunStarted } from './power-save';
import { createShellTrustContext, resolveProjectTrusted } from './project-trust';
import { settingsApi } from './settings-api';
import { timingMark } from '../utils/timing';
import { safeErrorFields, writePiDiagnostic } from '../utils/pi-diagnostic-log';
import { riskyWorkspaceReason } from '../utils/workspace-safety';
import {
  compatibilityFailure,
  loadPiAdapter,
  PiAdapterNotReadyError,
  type PiRuntimeAdapter,
} from './pi-adapter';
import { serializeSessionOp } from './session-mutex';

export type ActiveRuntime = {
  instanceId: string;
  adapter: PiRuntimeAdapter;
  adapterRuntime: PiRuntimeHandle;
  cwd: string;
  sessionId: string;
  generation: number;
  settingsHandle: PiSettingsHandle;
  modelRuntimeHandle: import('./pi-adapter').PiModelRuntimeHandle;
  /** 最近一次会话替换前跟踪的会话文件（sessionId/generation 之外的文件级锚点，供窗口改绑用） */
  sessionFile?: string;
  /** 传给 resourceLoader 的事件总线（pi-mcp-adapter 等扩展的状态通道挂在上面） */
  eventBus: PiEventBusPort;
  /**
   * 仅记录本次 pi 工具调用实际声明过的工作区外文件。
   * Renderer 永远不能任意读取绝对路径；此白名单只让工具卡能预览自己刚操作的文件。
   */
  previewableExternalFiles: Set<string>;
  running: boolean;
  mcpStatus: Record<string, unknown> | null;
  /** 项目信任随 factory 重跑更新；autoTrustCwd 供 reload 后隐式信任落盘（pi TUI 同款语义）。 */
  trust: { autoTrustCwd?: string };
  /** 分支摘要进行中（navigateTree/fork 带 summarize 的等待窗口；pi 无事件，壳按调用区间跟踪）。 */
  summarizingBranch: boolean;
  /** bash 完成时消息进 pending（流式中），需在回合结束（run.ended）补推快照带出。 */
  pendingBashRefresh: boolean;
  unsubscribe: () => void;
  pendingPrompts: Array<{ requestId: string; phase: 'accepted' | 'started' }>;
};

/** pi-mcp-adapter 的版本化状态通道。 */
export const MCP_STATUS_CHANNEL = 'pi-mcp-adapter/status/v1';

function emitPromptLifecycle(runtime: ActiveRuntime, phase: PiPromptLifecyclePhase, requestId: string, error?: string): void {
  sendHostEvent('piRuntime', 'promptLifecycle', {
    phase,
    requestId,
    runtimeId: runtime.instanceId,
    sessionId: runtime.sessionId,
    generation: runtime.generation,
    adapterGeneration: runtime.adapter.metadata.generation,
    ...(error ? { error: error.slice(0, 500) } : {}),
  });
}

let active: ActiveRuntime | null = null;
const runtimes = new Set<ActiveRuntime>();
/** 因运行中而暂缓回收的孤儿 runtime，等 run.ended / 窗口销毁清扫兜底。 */
const pendingDisposeRuntimes = new Set<ActiveRuntime>();
let runtimeSequence = 0;
let generationSequence = 0;
let startInFlight: Promise<PiRuntimeStateResult> | null = null;
let latestMcpStatus: Record<string, unknown> | null = null;

/** 当前活动运行时（供 piSessions 等兄弟服务复用；只读使用，替换会话须走 afterSessionReplaced）。 */
export function getActiveRuntime(): ActiveRuntime | null {
  return active;
}

/** settings.json 由壳写入后，刷新所有保活 runtime 的 SettingsManager 缓存。 */
export async function reloadRuntimeSettings(): Promise<void> {
  await Promise.all([...runtimes].map((runtime) =>
    runtime.adapter.settings.reload(runtime.settingsHandle).catch(() => undefined),
  ));
}

export function getRuntimeForSession(sessionPath: string): ActiveRuntime | null {
  for (const runtime of runtimes) {
    if (samePath(runtime.adapterRuntime.session.view.sessionFile, sessionPath)) return runtime;
  }
  return null;
}

/** 是否还有 runtime 把 cwd 作为工作区：该目录可能即将写入新会话文件，不能清空。 */
export function hasRuntimeWithCwd(cwd: string): boolean {
  return [...runtimes].some((runtime) => samePath(runtime.cwd, cwd));
}

/** 将已有 runtime 的完整状态只发送给一个窗口，用于独立窗口 attach/切换。 */
export function sendRuntimeStateToWindow(runtime: ActiveRuntime, target: HostActionContext): void {
  const state = snapshotState(runtime);
  sendHostEventToWebContents(target.sender, 'piRuntime', 'sessionReplaced', state);
}

/**
 * 按调用方上下文寻址 runtime：ctx 带 sessionPath（窗口绑定的会话）
 * 时用该会话的保活 runtime；否则回退全局 active（单窗口行为不变）。
 */
export function resolveRuntimeForContext(ctx?: { sessionPath?: string | null }): ActiveRuntime | null {
  if (ctx?.sessionPath) return getRuntimeForSession(ctx.sessionPath);
  return active;
}

/** resolveRuntimeForContext 的异步变体：无绑定会话时保留 getActiveRuntimeReady 的等待语义。 */
export async function resolveRuntimeForContextReady(
  ctx?: { sessionPath?: string | null },
): Promise<ActiveRuntime | null> {
  if (ctx?.sessionPath) return getRuntimeForSession(ctx.sessionPath);
  return getActiveRuntimeReady();
}

/**
 * 会话启动/替换后把调用方窗口绑到该 runtime 的会话文件。
 * 缺了这一步，从未 switch 过的主窗口 sessionPath 为 null，prompt 会回退全局 active，
 * 被独立会话窗口 attach 时新建的 runtime 抢走路由（消息串到别的会话）。
 */
function bindSenderToRuntime(ctx: HostActionContext | undefined, runtime: ActiveRuntime): void {
  const sessionFile = runtime.adapterRuntime.session.view.sessionFile;
  if (ctx && sessionFile) bindWindowSession(ctx.sender.id, sessionFile);
}

export function isSessionRunning(sessionPath: string): boolean {
  const runtime = getRuntimeForSession(sessionPath);
  return runtime?.adapterRuntime.session.view.isStreaming === true || runtime?.running === true;
}

/** 判断指定 cwd 是否有正在运行或流式输出中的 runtime。 */
export function isCwdRunning(cwd: string): boolean {
  return [...runtimes].some(
    (runtime) => samePath(runtime.cwd, cwd) && (runtime.adapterRuntime.session.view.isStreaming || runtime.running),
  );
}

/** 开发热更新等待安全重启时使用，覆盖主窗口和独立窗口的保活 runtime。 */
export function hasStreamingRuntimes(): boolean {
  return [...runtimes].some((runtime) => runtime.adapterRuntime.session.view.isStreaming || runtime.running);
}

/** SDK 列表暂未收录的保活会话（通常是仍在流式输出的首次 run）。 */
export function getLiveSessionRows(): Array<{
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: Date;
  modified: Date;
}> {
  const now = new Date();
  return [...runtimes].flatMap((entry) => {
    const session = entry.adapterRuntime.session;
    const sessionFile = session.sessionFile;
    if (!sessionFile) return [];
    const messages = session.messages as Array<{ role?: string; content?: unknown; timestamp?: number }>;
    const firstUser = messages.find((message) => message.role === 'user');
    const firstMessage = contentSummaryText(firstUser?.content);
    const stats = session.getSessionStats();
    return [{
      path: sessionFile,
      id: session.sessionId,
      cwd: entry.cwd,
      name: session.sessionManager.getSessionName() ?? undefined,
      firstMessage,
      messageCount: stats.totalMessages,
      created: firstUser?.timestamp ? new Date(firstUser.timestamp) : now,
      modified: now,
    }];
  });
}

export function activateSessionRuntime(runtime: ActiveRuntime): PiRuntimeStateResult {
  const previous = active;
  active = runtime;
  latestMcpStatus = runtime.mcpStatus;
  sendHostEvent('piMcp', 'statusChanged', { snapshot: latestMcpStatus });
  const state = snapshotState(runtime);
  sendHostEvent('piRuntime', 'sessionReplaced', state);
  for (const request of state.pendingUiRequests ?? []) sendHostEvent('piRuntime', 'uiRequest', request);
  if (previous && previous !== runtime) maybeDisposeRuntime(previous);
  return state;
}

function disposeRuntime(runtime: ActiveRuntime): void {
  runtime.unsubscribe();
  cancelPendingUiForContext({ sessionId: runtime.sessionId, generation: runtime.generation });
  if (runtime.running) {
    noteRunEnded(runtime.instanceId);
    runtime.running = false;
  }
  runtime.adapter.dispose(runtime.adapterRuntime);
  runtimes.delete(runtime);
  pendingDisposeRuntimes.delete(runtime);
  if (active === runtime) active = null;
}

/**
 * 替换/失联后的 runtime 回收判定：无人观看（findWindowBySession 为 null）、
 * 非全局 active、且不在运行（running/isStreaming）才 dispose。
 * 运行中的不能中断：登记待回收，由 run.ended / 窗口销毁的清扫兜底，
 * 否则持有它的窗口在流式期间关闭后 runtime 永久滞留（事件订阅等泄漏）。
 */
function maybeDisposeRuntime(runtime: ActiveRuntime): boolean {
  if (runtime === active) {
    pendingDisposeRuntimes.delete(runtime);
    return false;
  }
  if (runtime.running || runtime.adapterRuntime.session.view.isStreaming) {
    pendingDisposeRuntimes.add(runtime);
    return false;
  }
  pendingDisposeRuntimes.delete(runtime);
  const sessionFile = runtime.adapterRuntime.session.view.sessionFile;
  if (sessionFile && findWindowBySession(sessionFile) !== null) return false;
  disposeRuntime(runtime);
  return true;
}

/** 待回收 runtime 的兜底清扫：已结束运行且无人观看的回收，其余留在集合等下一轮。 */
function sweepPendingDisposeRuntimes(): void {
  for (const runtime of [...pendingDisposeRuntimes]) {
    maybeDisposeRuntime(runtime);
  }
}

// 窗口销毁后清扫一次：持有待回收 runtime 的窗口关闭时立即回收其中的空闲项。
// 经 app 级 browser-window-created 挂钩，保持 runtime 生命周期收敛在本模块，
// 不侵入 window-manager 的注册表。
// 容错：单测里 electron 可能是 npm 包导出的路径字符串（app 为 undefined），
// 也可能是未定义 app 导出的部分 mock（访问该绑定直接抛）；真实 main 进程两者不会发生。
try {
  if (typeof app?.on === 'function') {
    app.on('browser-window-created', (_event, win) => {
      win.once('closed', () => sweepPendingDisposeRuntimes());
    });
  }
} catch {
  // 非 Electron 运行时（单测直连 npm electron 包）：无窗口生命周期，无需清扫挂钩
}

export function disposeAllRuntimes(): void {
  for (const runtime of [...runtimes]) disposeRuntime(runtime);
  clearReviewBaseline();
}

/** 模型/设置页可能在初始 runtime 尚未落到 active 时操作；只等待已有启动，不主动创建。 */
export async function getActiveRuntimeReady(): Promise<ActiveRuntime | null> {
  if (startInFlight) await startInFlight.catch(() => {});
  return active;
}

/** 最近一次 pi-mcp-adapter 状态快照（未装 adapter / 未发过则为 null）。 */
export function getLatestMcpStatusSnapshot(): Record<string, unknown> | null {
  return latestMcpStatus;
}

/**
 * 与 messages 平行的 entry id 序列（仅 user 消息 entry 有值）。
 * pi 的 AgentMessage 不带 entryId；session.messages 与
 * buildContextEntries().flatMap(sessionEntryToContextMessages) 一一对应，
 * 按各 entry 产出的消息数重建对齐（流式中的 partial assistant 无 entry，尾部自然缺省）。
 */
function messageEntryIds(session: PiSessionPort): (string | null)[] {
  const ids: (string | null)[] = [];
  for (const entry of session.buildContextEntries()) {
    const producesMessage =
      entry.type === 'message' ||
      entry.type === 'custom_message' ||
      (entry.type === 'branch_summary' && Boolean(entry.summary)) ||
      entry.type === 'compaction';
    if (!producesMessage) continue;
    ids.push(entry.type === 'message' && (entry.message as { role?: unknown }).role === 'user' ? (entry.id ?? null) : null);
  }
  return ids;
}

/**
 * The runtime deliberately exposes only the active context in `messages` after
 * compaction. The transcript still needs the complete current branch so the UI
 * can render and navigate entries that were summarized away.
 */
function historyMessages(session: PiSessionPort): { messages: unknown[]; entryIds: (string | null)[] } {
  const messages: unknown[] = [];
  const entryIds: (string | null)[] = [];
  for (const entry of session.getBranch()) {
    // 必须走动态加载的用户环境 pi（包是 ESM-only，main 进程 CJS 包里 require 会直接崩）
    const converted = session.getModelContextMessages(entry);
    for (const message of converted) {
      messages.push(message);
      entryIds.push(entry.type === 'message' && (entry.message as { role?: unknown }).role === 'user' ? (entry.id ?? null) : null);
    }
  }
  // 不入上下文的 bash（!! / 命令模式默认）被模型上下文转换过滤，只存在于完整消息
  // 列表；按时间戳并回 history，否则并发回合后 displayMessages 走 history 丢失 bash 卡。
  const sessionMsgs = (session.messages ?? []) as Array<{ role?: string; timestamp?: number }>;
  const bashMsgs = sessionMsgs.filter((m) => m.role === 'bashExecution' && typeof m.timestamp === 'number');
  // 已由模型上下文转换保留的 bash（入上下文的 ! 命令）按时间戳去重，只补缺失的
  const seen = new Set<number>();
  for (const m of messages) {
    const t = (m as { timestamp?: number } | undefined)?.timestamp;
    if (typeof t === 'number' && (m as { role?: string }).role === 'bashExecution') seen.add(t);
  }
  for (const bashMsg of bashMsgs) {
    const ts = bashMsg.timestamp as number;
    if (seen.has(ts)) continue;
    seen.add(ts);
    let insertAt = messages.length;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const t = (messages[i] as { timestamp?: number } | undefined)?.timestamp;
      if (typeof t === 'number' && t <= ts) {
        insertAt = i + 1;
        break;
      }
    }
    messages.splice(insertAt, 0, bashMsg);
    entryIds.splice(insertAt, 0, null);
  }
  return { messages, entryIds };
}

function modelInfo(session: PiSessionPort): PiRuntimeModelInfo | undefined {
  const model = session.model;
  return model
    ? {
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxTokens,
      }
    : undefined;
}

function availableThinkingLevels(session: PiSessionPort): string[] {
  try {
    return session.getAvailableThinkingLevels();
  } catch {
    return [];
  }
}

function estimateContextTokens(runtime: ActiveRuntime, session: PiSessionPort): number {
  const messages = session.messages as unknown as Array<{
    role?: string;
    content?: unknown;
    summary?: string;
    stopReason?: string;
    usage?: Record<string, unknown>;
  }>;
  const latestCompaction = messages.reduce((index, message, current) =>
    message.role === 'compactionSummary' ? current : index, -1);
  // compaction 前的 assistant usage 不再代表当前上下文；从最近检查点开始按 pi
  // 同款字符/token estimator 计算，避免把旧上下文误算进当前百分比。
  const start = latestCompaction >= 0 ? latestCompaction : 0;
  let latestUsageIndex = -1;
  let latestUsageTokens = 0;
  if (latestCompaction < 0) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== 'assistant' || !message.usage) continue;
      if (message.stopReason === 'aborted' || message.stopReason === 'error') continue;
      const tokens = runtime.adapter.runtime.calculateContextTokens(message.usage);
      if (tokens > 0) {
        latestUsageIndex = index;
        latestUsageTokens = tokens;
      }
    }
  }
  let estimated = latestUsageIndex >= 0 ? latestUsageTokens : 0;
  const estimateFrom = latestUsageIndex >= 0 ? latestUsageIndex + 1 : start;
  for (let index = estimateFrom; index < messages.length; index += 1) {
    estimated += runtime.adapter.runtime.estimateTokens(messages[index]);
  }
  return Math.max(0, Math.round(estimated));
}

function contextUsage(runtime: ActiveRuntime): PiRuntimeContextUsage | undefined {
  const session = runtime.adapterRuntime.session;
  const usage = session.getContextUsage();
  const modelContextWindow = session.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const contextWindow = usage?.contextWindow && usage.contextWindow > 0
    ? usage.contextWindow
    : modelContextWindow;
  if (usage?.tokens != null) {
    return {
      tokens: usage.tokens,
      contextWindow,
      percent: usage.percent ?? (usage.tokens / contextWindow) * 100,
    };
  }
  const tokens = estimateContextTokens(runtime, session);
  return {
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
    estimated: true,
  };
}

function latestAssistantUsage(session: PiSessionPort): PiRuntimeUsageTurn | null {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index] as unknown as {
      role?: string;
      provider?: string;
      model?: string;
      usage?: Record<string, unknown>;
    };
    if (message.role !== 'assistant' || !message.usage) continue;
    const cost = message.usage.cost as { total?: unknown } | undefined;
    return {
      input: Number(message.usage.input ?? message.usage.prompt_tokens ?? 0),
      output: Number(message.usage.output ?? message.usage.completion_tokens ?? 0),
      cacheRead: Number(message.usage.cacheRead ?? 0),
      cacheWrite: Number(message.usage.cacheWrite ?? 0),
      cost: Number(cost?.total ?? 0),
      provider: message.provider,
      model: message.model,
    };
  }
  return null;
}

function modelUpdate(session: PiSessionPort, runtime: ActiveRuntime): PiRuntimeModelUpdateResult {
  return {
    success: true,
    model: modelInfo(session),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: availableThinkingLevels(session),
    contextUsage: contextUsage(runtime),
  };
}

function snapshotState(runtime: ActiveRuntime): PiRuntimeStateResult {
  const session = runtime.adapterRuntime.session;
  const history = historyMessages(session);
  return {
    sessionId: session.sessionId,
    cwd: runtime.cwd,
    generation: runtime.generation,
    model: modelInfo(session),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: availableThinkingLevels(session),
    isStreaming: session.isStreaming,
    running: runtime.running || session.isStreaming,
    messages: session.messages as unknown[],
    historyMessages: history.messages,
    messageEntryIds: messageEntryIds(session),
    historyMessageEntryIds: history.entryIds,
    sessionFile: session.sessionFile,
    contextUsage: contextUsage(runtime),
    branchSummarySkipPrompt: runtime.adapter.settings.getBranchSummarySkipPrompt(runtime.settingsHandle),
    extensionUi: getExtensionUiStateSnapshot({
      sessionId: runtime.sessionId,
      generation: runtime.generation,
    }),
    pendingUiRequests: getPendingUiRequests({
      sessionId: runtime.sessionId,
      generation: runtime.generation,
    }),
  };
}

function rememberPreviewableFile(runtime: ActiveRuntime, toolName: string, args: unknown): void {
  if (!['read', 'edit', 'write'].includes(toolName) || !args || typeof args !== 'object') return;
  const candidate = (args as { path?: unknown; file_path?: unknown }).path
    ?? (args as { file_path?: unknown }).file_path;
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return;
  runtime.previewableExternalFiles.add(normalizePreviewablePath(candidate));
}

function restorePreviewableExternalFiles(runtime: ActiveRuntime): void {
  runtime.previewableExternalFiles = previewableExternalFilesFromMessages(
    runtime.adapterRuntime.session.messages as unknown[],
    runtime.cwd,
  );
}

function desktopWorkspaceInstructions(cwd: string): string {
  return [
    '## Pi Desktop workspace rules',
    `The active workspace root is: ${cwd}`,
    'Create, edit, and read project files inside this workspace. Prefer paths relative to this root.',
    'Do not create or modify files outside this workspace unless the user explicitly asks to use another location.',
    'When starting a development server, do not leave it running in the foreground. Start it in the background with stdout and stderr redirected to a log file inside the workspace, then run a bounded health check. This lets the task continue and prevents the session from appearing stuck.',
  ].join('\n');
}

function isInsideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * pi 的官方扩展拦截点：只限制直接文件写工具，模型若需另一个项目必须让用户先在 GUI
 * 切换工作区。这样仍完全复用 pi 的工具执行与权限模型，不在壳里重做 agent/tool。
 */
function workspaceBoundaryExtension(pi: { on: (event: string, handler: (event: any, context: any) => unknown) => void }): void {
  pi.on('tool_call', (event, context) => {
    if (event.toolName !== 'write' && event.toolName !== 'edit') return;
    const input = event.input as { path?: unknown; file_path?: unknown };
    const requested = input.path ?? input.file_path;
    if (typeof requested !== 'string' || !requested.trim()) return;
    const target = path.resolve(context.cwd, requested);
    if (isInsideWorkspace(path.resolve(context.cwd), target)) return;
    return {
      block: true,
      reason: `Pi Desktop only writes inside the selected workspace (${context.cwd}). Select ${path.dirname(target)} as the workspace before editing ${target}.`,
    };
  });
}

// pi 事件结构漂移（未知类型/畸形 payload）的采样记录：每 reason+rawType 每分钟至多一条，防刷屏
const eventDropLogAt = new Map<string, number>();
const EVENT_DROP_LOG_INTERVAL_MS = 60_000;

function createEventDropLogger(runtime: ActiveRuntime): PiEventDropCallback {
  return (reason, rawType) => {
    const key = `${reason}:${rawType}`;
    const now = Date.now();
    if (now - (eventDropLogAt.get(key) ?? 0) < EVENT_DROP_LOG_INTERVAL_MS) return;
    eventDropLogAt.set(key, now);
    writePiDiagnostic({
      level: 'warning',
      event: 'pi.event.dropped',
      sessionId: runtime.sessionId,
      generation: runtime.generation,
      piVersion: runtime.adapter.packageVersion,
      eventType: rawType,
      detail: reason,
    });
  };
}

/** 建立会话事件桥并返回退订句柄；调用方负责句柄的保存与交换（见 afterSessionReplaced）。 */
function bridgeSessionEvents(runtime: ActiveRuntime): () => void {
  const session = runtime.adapterRuntime.session;
  const onDrop = createEventDropLogger(runtime);
  return session.subscribe((piEvent) => {
    try {
      const mapped = mapPiSessionEvent(piEvent, onDrop);
      if (!mapped) return;
      if (mapped.type === 'tool.execution.started') {
        rememberPreviewableFile(runtime, mapped.toolName, mapped.args);
      }
      // 防休眠挂钩（main 侧自治）：run 期间顶住休眠，重试等待保持，结束/替换解除
      if (mapped.type === 'run.started') {
        runtime.running = true;
        const pending = runtime.pendingPrompts.find((item) => item.phase === 'accepted');
        if (pending) {
          pending.phase = 'started';
          emitPromptLifecycle(runtime, 'started', pending.requestId);
        }
        noteRunStarted(runtime.instanceId);
        setImmediate(() => sendHostEvent('piRuntime', 'runtimeStateChanged', {
          sessionId: runtime.sessionId,
          sessionPath: runtime.adapterRuntime.session.sessionFile,
          running: runtime.running,
        }));
      } else if (mapped.type === 'run.ended') {
        if (!mapped.willRetry) {
          const pending = runtime.pendingPrompts.find((item) => item.phase === 'started');
          if (pending) {
            emitPromptLifecycle(runtime, 'finished', pending.requestId);
            runtime.pendingPrompts = runtime.pendingPrompts.filter((item) => item !== pending);
          }
        }
        // 流式中完成的 bash：pending 消息已随 agent_end flush，补推一次全量带出
        if (runtime.pendingBashRefresh) {
          runtime.pendingBashRefresh = false;
          sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(runtime));
        }
        noteRunEnded(runtime.instanceId, mapped.willRetry);
        if (!mapped.willRetry) {
          runtime.running = false;
          setImmediate(() => sendHostEvent('piRuntime', 'runtimeStateChanged', {
            sessionId: runtime.sessionId,
            sessionPath: runtime.adapterRuntime.session.sessionFile,
            running: false,
          }));
          // run 结束后兜底清扫：流式期间被替换/失联的待回收 runtime 此时才可安全回收
          sweepPendingDisposeRuntimes();
        }
      }
      const envelope: PiRuntimeEventEnvelope = {
        sessionId: runtime.sessionId,
        generation: runtime.generation,
        at: Date.now(),
        event: mapped,
      };
      sendHostEvent('piRuntime', 'event', envelope);
    } catch (error) {
      // A provider or newer pi release can add an event shape before the shell
      // adapter knows it. One malformed event must not reject pi's event loop.
      writePiDiagnostic({
        level: 'warning',
        event: 'pi.event.mapping.failure',
        sessionId: runtime.sessionId,
        generation: runtime.generation,
        piVersion: runtime.adapter.packageVersion,
        eventType: (piEvent as { type?: unknown })?.type as string | undefined,
        ...safeErrorFields(error),
      });
    }
  });
}

async function bindCurrentSession(runtime: ActiveRuntime): Promise<void> {
  const session = runtime.adapterRuntime.session;
  // 不调 bindExtensions 扩展收不到 session_start（MCP 等全部失效）。
  // 沿用 pi 的 print 宿主模式；桌面交互能力由显式 uiContext 提供。
  // uiContext 桥接 confirm/select/input 到渲染层对话框（electron/services/extension-ui.ts），
  // 不传则 hasUI=false，权限确认/plan mode/question 类扩展无法工作。
  await session.bindExtensions({
    mode: 'print',
    uiContext: createExtensionUIContext(() => ({
      sessionId: runtime.sessionId,
      generation: runtime.generation,
    })),
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      newSession: async (options) => {
        const result = await runtime.adapterRuntime.newSession(options);
        return { cancelled: result.cancelled };
      },
      fork: async (entryId, options) => {
        const result = await runtime.adapterRuntime.fork(entryId, options);
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId, options) => {
        const result = await session.navigateTree(targetId, options as { summarize?: boolean; customInstructions?: string });
        return { cancelled: result.cancelled, editorText: result.editorText };
      },
      switchSession: async (sessionPath, options) =>
        runtime.adapterRuntime.switchSession(sessionPath, options),
      reload: async () => {
        await session.reload();
      },
    },
    onError: (error) => {
      const err = error as { error?: unknown };
      const message =
        err.error instanceof Error ? err.error.message : String(err.error ?? 'unknown');
      sendHostEvent('piRuntime', 'event', {
        sessionId: runtime.sessionId,
        generation: runtime.generation,
        at: Date.now(),
        event: { type: 'retry.started', message: `extension error: ${message}` },
      } satisfies PiRuntimeEventEnvelope);
    },
  });
}

// per-cwd 信任决定缓存：对齐 pi CLI main.js 的 projectTrustByCwd，
// 同一进程内同一 cwd 只询问一次（含 switchSession 触发的 factory 重跑）。
const projectTrustByCwd = new Map<string, boolean>();

async function createRuntime(cwd: string, sessionPath?: string): Promise<ActiveRuntime> {
  // 工作区安全：主目录/盘符根不建 runtime（覆盖会话列表点击 home 组会话等入口）
  const risky = riskyWorkspaceReason(cwd);
  if (risky) throw new Error(`risky-workspace-${risky}`);
  timingMark('runtime:create:start');
  const adapter = await loadPiAdapter();
  if (adapter.compatibility.status === 'incompatible' || adapter.compatibility.status === 'restart-required') {
    throw new PiAdapterNotReadyError(compatibilityFailure(adapter.compatibility));
  }
  const agentDir = adapter.paths.getAgentDir();
  await syncLmStudioModels(agentDir);
  timingMark('runtime:lmstudio-synced');
  const piBin = adapter.cliPath;
  if (piBin) process.env.PI_CLI_PATH = piBin;
  const eventBusHandle = adapter.createEventBus();
  const hasTrustRequiring = adapter.trust.hasTrustRequiringProjectResources(cwd);
  const trust: { autoTrustCwd?: string } = {
    autoTrustCwd: hasTrustRequiring ? undefined : cwd,
  };
  const adapterRuntime = await adapter.createRuntime({
    cwd,
    sessionPath,
    eventBus: eventBusHandle,
    workspaceBoundary: true,
    appendSystemPrompt: (base) => [...base, desktopWorkspaceInstructions(cwd)],
    getProjectTrust: (effectiveCwd) => projectTrustByCwd.get(effectiveCwd),
    setProjectTrust: (effectiveCwd, trusted) => projectTrustByCwd.set(effectiveCwd, trusted),
    resolveTrust: async ({ cwd: effectiveCwd, trustStore, defaultProjectTrust, extensionsResult, onExtensionError }) =>
      resolveProjectTrusted({
        cwd: effectiveCwd,
        trustStore,
        defaultProjectTrust,
        extensionsResult,
        projectTrustContext: createShellTrustContext(effectiveCwd),
        onExtensionError,
      }),
  });
  timingMark('runtime:session-runtime-created');
  const settingsHandle = adapterRuntime.settings;
  const modelRuntimeHandle = adapterRuntime.modelRuntime;
  const active_: ActiveRuntime = {
    instanceId: `runtime-${++runtimeSequence}`,
    adapter,
    adapterRuntime,
    cwd,
    sessionId: adapterRuntime.session.sessionId,
    generation: ++generationSequence,
    settingsHandle,
    modelRuntimeHandle,
    sessionFile: adapterRuntime.session.sessionFile,
    eventBus: adapterRuntime.eventBus,
    previewableExternalFiles: new Set(),
    running: false,
    mcpStatus: null,
    trust,
    summarizingBranch: false,
    pendingBashRefresh: false,
    unsubscribe: () => {},
    pendingPrompts: [],
  };
  active_.eventBus.on(MCP_STATUS_CHANNEL, (data) => {
    active_.mcpStatus = (data ?? null) as Record<string, unknown> | null;
    if (active === active_) {
      latestMcpStatus = active_.mcpStatus;
      sendHostEvent('piMcp', 'statusChanged', { snapshot: latestMcpStatus });
    }
  });
  await bindCurrentSession(active_);
  timingMark('runtime:extensions-bound');
  restorePreviewableExternalFiles(active_);
  active_.unsubscribe = bridgeSessionEvents(active_);
  await captureReviewBaseline(cwd);
  timingMark('runtime:baseline-captured');
  runtimes.add(active_);
  return active_;
}

export async function createSessionRuntime(
  cwd: string,
  sessionPath?: string,
  options?: { activate?: boolean },
): Promise<PiRuntimeStateResult> {
  const runtime = await createRuntime(cwd, sessionPath);
  // activate=false：独立窗口 attach 的保活 runtime 不挤占全局 active。
  // 全局 active 代表主窗口当前会话（isCurrent 语义、未绑定窗口的回退都依赖它），
  // 被独立窗口抢走会导致主窗口会话串台/列表 isCurrent 误判。
  if (options?.activate === false) return snapshotState(runtime);
  return activateSessionRuntime(runtime);
}

/**
 * 为指定窗口创建并绑定 runtime。主窗口会更新全局 active，独立窗口则保持
 * 主窗口 active 不变；状态事件也只发给调用窗口。
 */
export async function createSessionRuntimeForWindow(
  cwd: string,
  sessionPath: string,
  target: HostActionContext,
): Promise<PiRuntimeStateResult> {
  const previousActive = active;
  const runtime = await createRuntime(cwd, sessionPath);
  const nextFile = runtime.adapterRuntime.session.sessionFile;
  if (target.sessionPath && nextFile && !samePath(target.sessionPath, nextFile)) {
    rebindWindowSessionForWindow(target.sender.id, target.sessionPath, nextFile);
  } else if (nextFile) {
    bindWindowSession(target.sender.id, nextFile);
  }
  if (isMainWindow(target.sender.id)) {
    active = runtime;
    latestMcpStatus = runtime.mcpStatus;
    sendHostEvent('piMcp', 'statusChanged', { snapshot: latestMcpStatus });
  }
  sendRuntimeStateToWindow(runtime, target);

  if (previousActive && previousActive !== runtime) maybeDisposeRuntime(previousActive);
  return snapshotState(runtime);
}

// 独立窗口打开的 runtime 预热：openDetached 在建窗/页面加载的同时就开始建保活 runtime；
// renderer attach 的 switch 到达（约 250ms 后）时在途则等其完成复用，不重复创建。
// completedPrewarms 标记预热产物：attach 语义的 switch 消费它（不挤占全局 active），
// 常规切换经 live 分支接管时用 clearPrewarmMark 清除。
const pendingSessionRuntimes = new Map<string, Promise<void>>();
const completedPrewarms = new Set<string>();

export function prewarmSessionRuntime(sessionPath: string, cwd?: string): void {
  // switch 需要 cwd 才能建 runtime；缺 cwd 不预热（attach 回退 listAll 推导，走正常路径）
  if (!cwd) return;
  if (getRuntimeForSession(sessionPath) || pendingSessionRuntimes.has(sessionPath)) return;
  timingMark('prewarm:start');
  const pending = createSessionRuntime(cwd, sessionPath, { activate: false })
    .then(() => {
      timingMark('prewarm:done');
      completedPrewarms.add(sessionPath);
    })
    .catch(() => undefined) // 失败静默：switch 会走正常创建路径并报错
    .finally(() => pendingSessionRuntimes.delete(sessionPath));
  pendingSessionRuntimes.set(sessionPath, pending);
}

/** 等预热在途完成（无预热立即返回）。 */
export async function awaitPendingPrewarm(sessionPath: string): Promise<void> {
  await pendingSessionRuntimes.get(sessionPath);
}

/** attach 语义消费预热产物：在途等完成；确为预热产物且 runtime 可用才算命中。 */
export async function consumePrewarmedSessionRuntime(sessionPath: string): Promise<boolean> {
  await awaitPendingPrewarm(sessionPath);
  if (!completedPrewarms.delete(sessionPath)) return false;
  return getRuntimeForSession(sessionPath) !== null;
}

/** 预热产物被常规切换路径（live 分支）接管时清除完成标记。 */
export function clearPrewarmMark(sessionPath: string): void {
  completedPrewarms.delete(sessionPath);
}

/**
 * 删除会话文件前，把持有它的所有保活 runtime（任一窗口/面板）切到全新会话，
 * 避免 runtime 继续往已删文件追加导致会话"复活"；replacesSessionId 让正在
 * 查看被删会话的面板认领到新会话（否则面板留在死会话上，发送报 session not started）。
 */
export async function detachRuntimesFromSessionFile(sessionPath: string): Promise<void> {
  for (const runtime of [...runtimes]) {
    if (!samePath(runtime.adapterRuntime.session.sessionFile, sessionPath)) continue;
    const previousSessionId = runtime.sessionId;
    try {
      await runtime.adapterRuntime.newSession();
      await afterSessionReplaced(runtime, undefined, { replacesSessionId: previousSessionId });
    } catch (err) {
      // 单个 runtime 失败不能中断循环：其余持有者仍要 detach，
      // 否则它们继续往已删会话文件追加（会话"复活"）
      writePiDiagnostic({
        level: 'error',
        event: 'session.detach-failed',
        sessionId: runtime.sessionId,
        generation: runtime.generation,
        piVersion: runtime.adapter.packageVersion,
        ...safeErrorFields(err),
      });
    }
  }
}

/** 会话替换（new/switch/fork）后的统一收尾：重绑 + 重订阅 + 通知渲染层清空。 */
export async function afterSessionReplaced(
  runtime: ActiveRuntime,
  target?: HostActionContext,
  options?: { replacesSessionId?: string; preserveRunning?: boolean; actionId?: string },
): Promise<PiRuntimeStateResult> {
  const previousActive = active;
  // 旧会话挂起的扩展 UI 请求全部取消（渲染层同步移除对话框）
  cancelPendingUiForContext({ sessionId: runtime.sessionId, generation: runtime.generation });
  // 旧会话若在运行中被替换，其 run.ended 不会再到：兜底解除防休眠
  if (runtime.running) {
    noteRunEnded(runtime.instanceId);
    runtime.running = false;
  }
  runtime.generation = ++generationSequence;
  runtime.sessionId = runtime.adapterRuntime.session.sessionId;
  // 订阅句柄原子交换：先建新订阅、后退旧订阅。先退再建的话，中间任何步骤
  // 抛异常 runtime 就失去事件桥且无自愈路径（用户发消息看不到任何流式响应）。
  const oldUnsubscribe = runtime.unsubscribe;
  try {
    try {
      await bindCurrentSession(runtime);
    } catch (err) {
      // 扩展重绑失败不静默：诊断留痕后仍要重建事件桥，会话本体可用
      writePiDiagnostic({
        level: 'error',
        event: 'session.rebind-failed',
        sessionId: runtime.sessionId,
        generation: runtime.generation,
        piVersion: runtime.adapter.packageVersion,
        ...safeErrorFields(err),
      });
    }
    restorePreviewableExternalFiles(runtime);
    runtime.unsubscribe = bridgeSessionEvents(runtime);
  } finally {
    oldUnsubscribe();
  }
  // fork/newSession 会换新会话文件，绑定旧文件的窗口改绑到新文件，
  // 否则后续 hostInvoke 按旧路径寻址 runtime 会失败（必须在推事件前完成）
  const previousFile = runtime.sessionFile;
  const nextFile = runtime.adapterRuntime.session.sessionFile;
  runtime.sessionFile = nextFile;
  if (previousFile && nextFile && !samePath(previousFile, nextFile)) {
    if (target) rebindWindowSessionForWindow(target.sender.id, previousFile, nextFile);
    else rebindWindowSession(previousFile, nextFile);
  }
  // 主窗口发起的隔离替换要更新全局 active（侧栏 isCurrent / 无 scope 回退）；
  // 独立窗口发起时则保持主窗口 active 不变。
  if (options?.preserveRunning) runtime.running = true;
  const state = snapshotState(runtime);
  if (options?.replacesSessionId) state.replacesSessionId = options.replacesSessionId;
  // 回显发起动作 id：同窗口多面板并发替换时各面板据此只认领自己发起的事件
  if (options?.actionId) state.replacementActionId = options.actionId;
  if (target) sendHostEventToWebContents(target.sender, 'piRuntime', 'sessionReplaced', state);
  else sendHostEvent('piRuntime', 'sessionReplaced', state);

  if (previousActive && previousActive !== runtime) maybeDisposeRuntime(previousActive);
  return state;
}

function shouldIsolateSessionReplacement(runtime: ActiveRuntime, ctx?: HostActionContext): boolean {
  const sessionPath = runtime.adapterRuntime.session.sessionFile;
  return Boolean(sessionPath && ctx && hasSessionInOtherWindow(sessionPath, ctx.sender.id));
}

async function createReplacementRuntime(
  current: ActiveRuntime,
  ctx?: HostActionContext,
  actionId?: string,
): Promise<ActiveRuntime> {
  const wasRunning = current.running || current.adapterRuntime.session.isStreaming;
  const replacement = await createRuntime(current.cwd);
  if (ctx) {
    await afterSessionReplaced(replacement, ctx, actionId !== undefined ? { actionId } : undefined);
    if (wasRunning) {
      replacement.running = true;
      sendHostEventToWebContents(ctx.sender, 'piRuntime', 'sessionReplaced', snapshotState(replacement));
    }
  } else activateSessionRuntime(replacement);
  if (ctx) bindSenderToRuntime(ctx, replacement);
  return replacement;
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 消息 content（string 或 content block 数组）→ 单行摘要文本。 */
function contentSummaryText(content: unknown): string {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((b) => {
              const block = b as { type?: string; text?: string; name?: string };
              if (block?.type === 'text') return block.text ?? '';
              if (block?.type === 'toolCall') return `[${block.name ?? 'tool'}]`;
              return '';
            })
            .filter(Boolean)
            .join(' ')
        : '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** 树节点的展示摘要；结构噪音 entry（model/thinking 变更、label 等）返回 null 跳过。 */
function treeEntrySummary(entry: PiSessionEntry): { kind: PiRuntimeTreeNode['kind']; text: string } | null {
  if (entry.type === 'message') {
    const role = (entry.message as { role?: unknown }).role;
    return {
      kind: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'other',
      text: contentSummaryText((entry.message as { content?: unknown }).content),
    };
  }
  if (entry.type === 'custom_message') {
    return { kind: 'user', text: contentSummaryText(entry.content) };
  }
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return { kind: 'other', text: contentSummaryText(entry.summary) };
  }
  return null;
}

/** 壳支持的 pi 内建斜杠命令（描述是英文回退，渲染层按名字走 i18n）。 */
const SHELL_BUILTIN_COMMANDS: Array<{ name: string; description: string }> = [
  { name: 'new', description: 'Start a new session' },
  { name: 'compact', description: "Compact this chat's context" },
  { name: 'tree', description: 'Navigate session branches' },
  { name: 'model', description: 'Select model' },
  { name: 'name', description: 'Set session display name' },
  { name: 'copy', description: 'Copy last agent message to clipboard' },
  { name: 'export', description: 'Export session to HTML' },
  { name: 'session', description: 'Show session info and stats' },
  { name: 'settings', description: 'Open settings' },
  { name: 'login', description: 'Configure provider authentication' },
  { name: 'logout', description: 'Remove provider authentication' },
  { name: 'reload', description: 'Reload extensions, skills, prompts and context files' },
  { name: 'resume', description: 'Resume a different session' },
];

/**
 * 从 pi 队列移除单条消息并返回其文本（越界返回 null）。
 * pi SDK 只有 clearQueue（全清）：快照两个队列 → 全清 → 按原顺序重放其余项，
 * 保留各自的 steer/followUp 语义（不自造队列，壳只重放 pi 的入队 API）。
 * 注意 session.clearQueue 只清 session 级跟踪数组，agent-core 内部的
 * steeringQueue/followUpQueue 要一并 clearAllQueues，否则重放会重复入队。
 */
async function removeQueuedItem(
  session: PiSessionPort,
  payload: PiRuntimeQueueItemPayload,
): Promise<string | null> {
  const steering = [...session.getSteeringMessages()];
  const followUp = [...session.getFollowUpMessages()];
  const list = payload.kind === 'steering' ? steering : followUp;
  if (payload.index < 0 || payload.index >= list.length) return null;
  const [removed] = list.splice(payload.index, 1);
  session.clearQueue();
  session.clearAgentQueues();
  for (const text of steering) await session.steer(text);
  for (const text of followUp) await session.followUp(text);
  return removed ?? null;
}

/**
 * 会话启动上限。超时后渲染层得到错误（可重试），底层构建继续在后台完成：
 * startInFlight 只在构建自然结束时清理，重试会复用同一个构建而不是再起一个。
 * E2E 用 PI_DESKTOP_START_TIMEOUT_MS 缩短超时（须同时置 PI_DESKTOP_E2E=1），
 * 否则每个超时用例都要真等 45s。
 */
const START_TIMEOUT_MS = process.env.PI_DESKTOP_E2E === '1' && process.env.PI_DESKTOP_START_TIMEOUT_MS
  ? Number(process.env.PI_DESKTOP_START_TIMEOUT_MS)
  : 45_000;

export const piRuntimeApi = {
  start: async (payload: PiRuntimeStartPayload, ctx?: HostActionContext): Promise<PiRuntimeStateResult> => {
    // 工作区安全：主目录/根目录不启动 runtime（覆盖启动恢复 workspaceCwd 的旧危险值）；
    // 抛出的错误码由渲染层翻译成用户可见文案。
    const risky = riskyWorkspaceReason(payload.cwd);
    if (risky) throw new Error(`risky-workspace-${risky}`);
    // samePath：/tmp ↔ /private/tmp 等形式差异不应触发无谓的 runtime 重建
    if (active && samePath(active.cwd, payload.cwd)) {
      bindSenderToRuntime(ctx, active);
      return snapshotState(active);
    }
    if (startInFlight) await startInFlight.catch(() => {});
    // 等完上一个构建后复看：可能恰好就是目标 cwd（如超时后的重试）
    if (active && samePath(active.cwd, payload.cwd)) {
      bindSenderToRuntime(ctx, active);
      return snapshotState(active);
    }
    if (active && !samePath(active.cwd, payload.cwd) && !active.adapterRuntime.session.isStreaming) {
      disposeRuntime(active);
    }
    const flight = (async () => {
      const runtime = await createRuntime(payload.cwd);
      active = runtime;
      latestMcpStatus = runtime.mcpStatus;
      return snapshotState(runtime);
    })();
    startInFlight = flight;
    // 构建自然结束（成功或失败）后清理 in-flight 标记；超时不清理（见上方注释）
    void flight.catch(() => {}).then(() => {
      if (startInFlight === flight) startInFlight = null;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const state = await Promise.race([
        flight,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('start-timeout')), START_TIMEOUT_MS);
        }),
      ]);
      if (active) bindSenderToRuntime(ctx, active);
      return state;
    } catch (err) {
      // 会话构建失败里的模型不可用文本（含恢复会话场景）转结构化错误码，
      // 渲染层按 MODEL_UNAVAILABLE 提供换模型自救入口；其余错误原样上抛。
      const modelError = toModelUnavailableError(toError(err));
      if (modelError) throw modelError;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  getState: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeStateResult | null => {
    const active = resolveRuntimeForContext(ctx);
    return active ? snapshotState(active) : null;
  },

  getContextUsage: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeContextUsage | null => {
    const active = resolveRuntimeForContext(ctx);
    return active ? contextUsage(active) ?? null : null;
  },

  getUsage: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeUsageResult | null => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return null;
    const session = active.adapterRuntime.session;
    const stats = session.getSessionStats();
    return {
      context: contextUsage(active) ?? null,
      model: modelInfo(session),
      session: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        cost: stats.cost,
      },
      latestTurn: latestAssistantUsage(session),
    };
  },

  prompt: async (payload: PiRuntimePromptPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.adapterRuntime.session;
    const requestId = ctx?.requestId ?? randomUUID();
    emitPromptLifecycle(active, 'submitted', requestId);
    const pendingPrompt = { requestId, phase: 'accepted' as const };
    active.pendingPrompts.push(pendingPrompt);
    try {
      // @path 就地展开为 <file> 块（pi file-processor 语义；图片转 images 通道）
      const expanded = await expandFileReferences(payload.text, active.cwd);
      const staged = (payload.images ?? []) as unknown[];
      await session.prompt({
        text: expanded.text,
        images: [...expanded.images, ...staged],
        // 流式中提交：默认 followUp（排队等当前 run 完成），behavior='steer' 时当前轮插入
        ...(session.isStreaming
          ? { streamingBehavior: payload.behavior ?? ('followUp' as const) }
          : {}),
        preflightResult: (accepted: boolean) => {
          if (accepted) emitPromptLifecycle(active, 'accepted', requestId);
          else {
            emitPromptLifecycle(active, 'failed', requestId, 'prompt preflight rejected');
            active.pendingPrompts = active.pendingPrompts.filter((item) => item !== pendingPrompt);
          }
        },
      });
      if (pendingPrompt.phase === 'accepted' && !session.isStreaming && !active.running) {
        emitPromptLifecycle(active, 'finished', requestId);
        active.pendingPrompts = active.pendingPrompts.filter((item) => item !== pendingPrompt);
      }
      return { success: true };
    } catch (err) {
      writePiDiagnostic({
        level: 'error',
        event: 'prompt.failed',
        requestId: ctx?.requestId,
        sessionId: active.sessionId,
        generation: active.generation,
        piVersion: active.adapter.packageVersion,
        ...safeErrorFields(err),
      });
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  queueRemove: async (payload: PiRuntimeQueueItemPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const removed = await removeQueuedItem(active.adapterRuntime.session, payload);
    return removed ? { success: true, text: removed } : { success: false, error: 'queue index out of range' };
  },

  queueMove: async (payload: PiRuntimeQueueItemPayload & { target: 'steering' | 'followUp' }, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    if (payload.kind === payload.target) return { success: true };
    const session = active.adapterRuntime.session;
    const text = await removeQueuedItem(session, payload);
    if (text == null) return { success: false, error: 'queue index out of range' };
    try {
      if (payload.target === 'steering') {
        // 立即发送：流式中 = steer（当前轮工具间隙插入），空闲 = 直接开新轮投递。
        // 只入队不投递会让消息在 run 结束后永远卡在队列里（改回 9c7ba38 前的语义）。
        if (session.isStreaming) await session.steer(text);
        else await session.prompt({ text });
      } else {
        await session.followUp(text);
      }
      return { success: true, text };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** stop 按钮按当前状态分发（pi TUI 的 Escape 语义）：压缩中/分支摘要中/重试等待中分别接对应 abort。 */
  abort: async (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.adapterRuntime.session;
    const restoredMessages = [...session.getSteeringMessages(), ...session.getFollowUpMessages()];
    if (restoredMessages.length > 0) {
      session.clearQueue();
      session.clearAgentQueues();
    }
    // bash 停止走独立的 abortBash（bash 卡/命令面板按钮），与回合停止分离：
    // 这里只处理回合/压缩/分支摘要/重试，保证后台命令在回合中断时继续跑。
    if (session.isCompacting) session.abortCompaction();
    else if (active.summarizingBranch) session.abortBranchSummary();
    else if (session.isRetrying) session.abortRetry();
    else await session.abort();
    if (active.running || session.isStreaming) {
      active.running = false;
      noteRunEnded(active.instanceId);
      sendHostEvent('piRuntime', 'runtimeStateChanged', {
        sessionId: active.sessionId,
        sessionPath: session.sessionFile,
        running: false,
      });
    }
    return { success: true, restoredMessages };
  },

  /** 只停止正在运行的 bash（bash 卡/命令面板的停止按钮），不碰消息回合与压缩等。 */
  abortBash: async (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    if (active.adapterRuntime.session.isBashRunning) active.adapterRuntime.session.abortBash();
    return { success: true };
  },

  newSession: async (payload?: PiRuntimeNewSessionPayload, ctx?: HostActionContext) => {
    // 渲染层发起替换动作的关联 id：随 sessionReplaced 回显，发起面板据此认领事件
    const actionId = typeof payload?.actionId === 'string' ? payload.actionId : undefined;
    const runtime = resolveRuntimeForContext(ctx);
    if (!runtime) return { success: false, error: 'session not started' };
    // 以被替换的会话文件为锁键串行（排队期间状态可能变化，锁内重解析 runtime）
    const key = runtime.adapterRuntime.session.view.sessionFile ?? runtime.instanceId;
    return serializeSessionOp(key, async () => {
      const active = resolveRuntimeForContext(ctx);
      if (!active) return { success: false, error: 'session not started' };
      // 同一会话可同时显示在多个窗口。此时不能在共享 runtime 上原地
      // newSession，否则所有窗口都会收到 sessionReplaced；只为发起窗口创建新 runtime。
      if (active.adapterRuntime.session.isStreaming || active.running || shouldIsolateSessionReplacement(active, ctx)) {
        try {
          await createReplacementRuntime(active, ctx, actionId);
          return { success: true };
        } catch (err) {
          return { success: false, error: toError(err) };
        }
      }
      await active.adapterRuntime.newSession();
      await afterSessionReplaced(active, ctx, actionId !== undefined ? { actionId } : undefined);
      bindSenderToRuntime(ctx, active);
      return { success: true };
    });
  },

  /** 消息级 fork（TUI /fork 选消息）：position='before'，新会话不含被选消息，文本回填编辑器。 */
  fork: async (payload: PiRuntimeForkPayload, ctx?: HostActionContext): Promise<PiRuntimeForkResult> => {
    const runtime = resolveRuntimeForContext(ctx);
    if (!runtime) return { success: false, error: 'session not started' };
    // 以被 fork 的会话文件为锁键串行（排队期间状态可能变化，锁内重解析 runtime）
    const key = runtime.adapterRuntime.session.view.sessionFile ?? runtime.instanceId;
    return serializeSessionOp(key, async () => {
      const active = resolveRuntimeForContext(ctx);
      if (!active) return { success: false, error: 'session not started' };
      if (active.adapterRuntime.session.isStreaming) return { success: false, error: 'session is streaming' };
      let forkRuntime = active;
      let isolated = false;
      try {
        // fork 也会改变 runtime 的 session file。共享会话时先从原文件创建独立
        // runtime，避免另一个窗口收到 fork 后被错误改绑。
        if (shouldIsolateSessionReplacement(active, ctx)) {
          const sessionPath = active.adapterRuntime.session.sessionFile;
          if (!sessionPath) return { success: false, error: 'session has no file' };
          forkRuntime = await createRuntime(active.cwd, sessionPath);
          isolated = true;
        }
        const result = await forkRuntime.adapterRuntime.fork(payload.entryId);
        if (result.cancelled) {
          if (isolated) disposeRuntime(forkRuntime);
          return { success: false, error: 'cancelled' };
        }
        // fork 产生新会话文件并整体替换 runtime：走既有 sessionReplaced 刷新流程
        // （actionId 随事件回显，发起面板据此认领自己的 fork 结果）
        await afterSessionReplaced(
          forkRuntime,
          ctx,
          typeof payload?.actionId === 'string' ? { actionId: payload.actionId } : undefined,
        );
        bindSenderToRuntime(ctx, forkRuntime);
        return { success: true, selectedText: result.selectedText };
      } catch (err) {
        if (isolated) disposeRuntime(forkRuntime);
        return { success: false, error: toError(err) };
      }
    });
  },

  getTree: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeTreeResult => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { nodes: [] };
    const session = active.adapterRuntime.session;
    const sm = session.sessionManager;
    const leafId = sm.getLeafId();
    // 当前分支路径（leaf 及其祖先链），面板里高亮用
    const onPath = new Set<string>();
    let cursor = leafId;
    while (cursor) {
      onPath.add(cursor);
      cursor = sm.getEntry(cursor)?.parentId ?? null;
    }
    const nodes: PiRuntimeTreeNode[] = [];
    const walk = (list: PiSessionTreeNode[], depth: number) => {
    for (const node of list) {
        const summary = treeEntrySummary(node.entry);
        if (summary) {
          nodes.push({
            id: node.entry.id ?? '',
            depth,
            kind: summary.kind,
            text: summary.text,
            label: node.label,
            isLeaf: node.entry.id === leafId,
            onCurrentPath: node.entry.id ? onPath.has(node.entry.id) : false,
          });
        }
        // 被跳过的节点不占用缩进深度
        walk(node.children, summary ? depth + 1 : depth);
      }
    };
    walk(session.getTree(), 0);
    return { nodes };
  },

  /** 分支跳转（TUI /tree）：同会话文件内移动 leaf，session 对象不变，推全量状态刷新列表。 */
  navigateTree: async (payload: PiRuntimeNavigatePayload, ctx?: HostActionContext): Promise<PiRuntimeNavigateResult> => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const summarize = payload.summarize === true;
    try {
      // 摘要进行中标记：stop 按钮据此分发 abortBranchSummary（pi 无对应事件）
      if (summarize) active.summarizingBranch = true;
      const result = await active.adapterRuntime.session.navigateTree(payload.targetId, {
        summarize: payload.summarize,
        customInstructions: payload.customInstructions,
      });
      if (result.aborted) return { success: false, aborted: true, error: 'aborted' };
      if (result.cancelled) return { success: false, error: 'cancelled' };
      sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      return { success: true, editorText: result.editorText };
    } catch (err) {
      return { success: false, error: toError(err) };
    } finally {
      if (summarize) active.summarizingBranch = false;
    }
  },

  compact: async (payload?: PiRuntimeCompactPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    try {
      await active.adapterRuntime.session.compact(payload?.customInstructions);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** `!` bash 命令（TUI handleBashCommand 语义：扩展可经 user_bash 事件拦截执行）。 */
  executeBash: async (payload: PiRuntimeBashPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.adapterRuntime.session;
    // TUI：已有 bash 在跑时拒绝并发（先 Esc 取消）
    if (session.isBashRunning) return { success: false, error: 'bash already running' };
    try {
      const excludeFromContext = payload.excludeFromContext === true;
      const eventResult = await session.extensionRunner.emitUserBash({
        type: 'user_bash',
        command: payload.command,
        excludeFromContext,
        cwd: session.sessionManager.getCwd(),
      });
      if (eventResult?.result) {
        // 扩展直接给出执行结果：只记录不执行
        session.recordBashResult(payload.command, eventResult.result, { excludeFromContext });
      } else {
        await session.executeBash(payload.command, {
          excludeFromContext,
          operations: eventResult?.operations,
        });
      }
      // bash 完成：消息可能已落盘或刚进 pending（recordBashResult 时回合仍在跑）。
      // 立即推快照会撞上 agent_end flush 的竞态窗口（快照缺 bash）；延迟一拍再推，
      // 同时置 pendingBashRefresh 由 run.ended 兜底带出（标记残留无害，幂等）。
      active.pendingBashRefresh = true;
      setTimeout(() => {
        if (!session.isStreaming) sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      }, 400);
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  /** /name <text>：重命名当前会话（pi session.setSessionName，返回值是规范化后的名字）。 */
  setSessionName: async (payload: { name: string; notify?: boolean }, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const name = payload.name.trim();
    if (!name) return { success: false, error: 'empty name' };
    try {
      active.adapterRuntime.session.setSessionName(name);
      // 侧栏会话列表靠 sessionReplaced / isStreaming 翻转刷新；
      // streaming 中推全量会丢 partial 消息，跳过（流结束时列表自会刷新）。
      if (payload.notify !== false && !active.adapterRuntime.session.isStreaming) {
        sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      }
      return { success: true, name: active.adapterRuntime.session.sessionManager.getSessionName() };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  /** /session：会话信息（pi handleSessionCommand 的 getSessionStats + 会话名）。 */
  getSessionInfo: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeSessionInfo | null => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return null;
    const session = active.adapterRuntime.session;
    const stats = session.getSessionStats();
    // pi 自动命名可能把附件信封带进会话名，标题栏展示前剥离（与列表出口 toRow 一致）
    const name = session.sessionManager.getSessionName();
    return {
      name: name ? stripAttachmentEnvelope(name) || undefined : name,
      sessionId: stats.sessionId,
      sessionFile: stats.sessionFile,
      model: session.model
        ? { provider: session.model.provider, id: session.model.id, name: session.model.name }
        : undefined,
      totalMessages: stats.totalMessages,
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
      toolResults: stats.toolResults,
      tokens: { ...stats.tokens },
      cost: stats.cost,
    };
  },

  /** /reload：重载扩展/skills/prompts/主题/上下文文件（pi handleReloadCommand 语义）。 */
  reload: async (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.adapterRuntime.session;
    // pi /reload：生成中/压缩中禁止
    if (session.isStreaming) return { success: false, error: 'session is streaming' };
    if (session.isCompacting) return { success: false, error: 'session is compacting' };
    try {
      resetExtensionUiState({ sessionId: active.sessionId, generation: active.generation });
      await session.reload();
      // pi TUI maybeSaveImplicitProjectTrustAfterReload 语义：启动时无门控资源而默认信任的
      // cwd，reload 后若出现门控资源且仍处于信任态，隐式落 trust=true（下次启动不再询问）。
      if (
        active.trust.autoTrustCwd === active.cwd
        && active.adapter.settings.isProjectTrusted(active.settingsHandle)
        && active.adapter.trust.hasTrustRequiringProjectResources(active.cwd)
      ) {
        active.trust.autoTrustCwd = undefined;
        try {
          await active.adapter.trust.set(active.cwd, true);
        } catch {
          // 落盘失败不阻塞 reload（pi TUI 仅告警）
        }
      }
      restorePreviewableExternalFiles(active);
      // TUI /reload 后 rebuildChatFromMessages + 重建补全源；壳推全量状态（渲染层重取命令列表）
      sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  /** /export [path]：导出当前会话 HTML；缺省统一落到 Pi Desktop 的系统文档目录。 */
  exportHtml: async (payload?: PiRuntimeExportPayload, ctx?: HostActionContext): Promise<PiSessionExportResult> => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    try {
      const outputPath = payload?.outputPath
        ?? (active.adapterRuntime.session.sessionFile
          ? await sessionExportPath(active.adapterRuntime.session.sessionFile)
          : undefined);
      const exported = await active.adapterRuntime.session.exportToHtml(outputPath);
      await settingsApi.set({ key: 'lastSessionExportPath', value: exported });
      return { success: true, path: exported };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  setThinkingLevel: async (payload: { level: string }, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    active.adapterRuntime.session.setThinkingLevel(payload.level);
    return modelUpdate(active.adapterRuntime.session, active);
  },

  setModel: async (payload: { provider: string; id: string }, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const model = active.adapter.providers.getModel(active.modelRuntimeHandle, payload.provider, payload.id);
    if (!model) return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
    await active.adapterRuntime.session.setModel(model);
    return modelUpdate(active.adapterRuntime.session, active);
  },

  /**
   * / 补全数据源：壳内建命令 + prompt 模板 + 扩展 registerCommand 命令 + skills。
   * 扩展命令来源与 pi autocomplete 相同（extensionRunner.getRegisteredCommands），
   * 与内建同名的被 pi 跳过/改名，对外用 invocationName（interactive-mode 同款过滤）。
   */
  getCommands: (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { commands: [] };
    const prompts = active.adapter.resources.getPrompts(active.adapterRuntime).map((raw) => {
      const p = raw as { name?: unknown; description?: unknown; sourceInfo?: unknown };
      return {
        name: String(p.name ?? ''),
        description: typeof p.description === 'string' ? p.description : undefined,
        source: `prompt:${(p.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
      };
    });
    const skills = active.adapter.resources.getSkills(active.adapterRuntime).map((raw) => {
      const s = raw as { name?: unknown; description?: unknown; sourceInfo?: unknown };
      return {
        name: `skill:${String(s.name ?? '')}`,
        description: typeof s.description === 'string' ? s.description : undefined,
        source: `skill:${(s.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
      };
    });
    const builtinNames = new Set(SHELL_BUILTIN_COMMANDS.map((c) => c.name));
    const extensionCommands = active.adapterRuntime.session.extensionRunner
      .getRegisteredCommands()
      .filter((c) => !builtinNames.has(c.name))
      .map((c) => ({
        name: c.invocationName,
        description: c.description,
        source: `extension:${(c.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
      }));
    const builtIns = SHELL_BUILTIN_COMMANDS.map((c) => ({ ...c, source: 'built-in' }));
    return { commands: [...builtIns, ...prompts, ...extensionCommands, ...skills] };
  },

  /** 扩展 UI 对话框的用户响应（extension-ui.ts 里挂起的 Promise 按 requestId 配对 resolve）。 */
  uiResponse: (payload: PiUiResponsePayload) => resolveUiResponse(payload),
};
