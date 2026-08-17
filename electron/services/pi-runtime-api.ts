// pi 会话运行时：壳与 pi SDK 的唯一接触面之一（会话生命周期 + 事件桥）。
// 事件映射在 shared/pi-event-map.ts（单点）。会话替换（new/switch/fork）后
// 必须重新 subscribe + bindExtensions（SDK 约定）。
import {
  mapPiSessionEvent,
  type PiRuntimeEventEnvelope,
} from '@shared/pi-event-map';
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
} from '@shared/host-api/contract';
import { stripAttachmentEnvelope } from '@shared/message-attachments';
import type {
  AgentSession,
  AgentSessionRuntime,
  EventBus,
  ExtensionAPI,
  SessionEntry,
  SessionTreeNode,
} from '@earendil-works/pi-coding-agent';
import path from 'node:path';
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
import { detectPiEnvironment } from '../utils/pi-detector';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';
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

export type ActiveRuntime = {
  instanceId: string;
  sdk: PiSdk;
  runtime: AgentSessionRuntime;
  cwd: string;
  sessionId: string;
  generation: number;
  /** 最近一次会话替换前跟踪的会话文件（sessionId/generation 之外的文件级锚点，供窗口改绑用） */
  sessionFile?: string;
  /** 传给 resourceLoader 的事件总线（pi-mcp-adapter 等扩展的状态通道挂在上面） */
  eventBus: EventBus;
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
  unsubscribe: () => void;
};

/** pi-mcp-adapter 的版本化状态通道。 */
export const MCP_STATUS_CHANNEL = 'pi-mcp-adapter/status/v1';

let active: ActiveRuntime | null = null;
const runtimes = new Set<ActiveRuntime>();
let runtimeSequence = 0;
let generationSequence = 0;
let startInFlight: Promise<PiRuntimeStateResult> | null = null;
let latestMcpStatus: Record<string, unknown> | null = null;

/** 当前活动运行时（供 piSessions 等兄弟服务复用；只读使用，替换会话须走 afterSessionReplaced）。 */
export function getActiveRuntime(): ActiveRuntime | null {
  return active;
}

export function getRuntimeForSession(sessionPath: string): ActiveRuntime | null {
  for (const runtime of runtimes) {
    if (samePath(runtime.runtime.session.sessionFile, sessionPath)) return runtime;
  }
  return null;
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
  const sessionFile = runtime.runtime.session.sessionFile;
  if (ctx && sessionFile) bindWindowSession(ctx.sender.id, sessionFile);
}

export function isSessionRunning(sessionPath: string): boolean {
  return getRuntimeForSession(sessionPath)?.runtime.session.isStreaming === true;
}

/** 开发热更新等待安全重启时使用，覆盖主窗口和独立窗口的保活 runtime。 */
export function hasStreamingRuntimes(): boolean {
  return [...runtimes].some((runtime) => runtime.runtime.session.isStreaming);
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
    const session = entry.runtime.session;
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
  // 仍有窗口绑定着的 runtime 不回收（其他窗口正在看它）
  const previousFile = previous?.runtime.session.sessionFile;
  const previousWatched = previousFile ? findWindowBySession(previousFile) !== null : false;
  if (previous && previous !== runtime && !previous.runtime.session.isStreaming && !previousWatched) {
    disposeRuntime(previous);
  }
  return state;
}

function disposeRuntime(runtime: ActiveRuntime): void {
  runtime.unsubscribe();
  cancelPendingUiForContext({ sessionId: runtime.sessionId, generation: runtime.generation });
  if (runtime.running) {
    noteRunEnded(runtime.instanceId);
    runtime.running = false;
  }
  runtime.runtime.dispose();
  runtimes.delete(runtime);
  if (active === runtime) active = null;
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
function messageEntryIds(session: AgentSession): (string | null)[] {
  const ids: (string | null)[] = [];
  for (const entry of session.sessionManager.buildContextEntries()) {
    const producesMessage =
      entry.type === 'message' ||
      entry.type === 'custom_message' ||
      (entry.type === 'branch_summary' && Boolean(entry.summary)) ||
      entry.type === 'compaction';
    if (!producesMessage) continue;
    ids.push(entry.type === 'message' && entry.message.role === 'user' ? entry.id : null);
  }
  return ids;
}

function modelInfo(session: AgentSession): PiRuntimeModelInfo | undefined {
  const model = session.model;
  return model
    ? {
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }
    : undefined;
}

function availableThinkingLevels(session: AgentSession): string[] {
  try {
    const getter = (session as unknown as { getAvailableThinkingLevels?: () => string[] })
      .getAvailableThinkingLevels;
    return typeof getter === 'function' ? getter.call(session) : [];
  } catch {
    return [];
  }
}

function contextUsage(session: AgentSession): PiRuntimeContextUsage | undefined {
  const usage = session.getContextUsage();
  return usage
    ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
    : undefined;
}

function latestAssistantUsage(session: AgentSession): PiRuntimeUsageTurn | null {
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

function modelUpdate(session: AgentSession): PiRuntimeModelUpdateResult {
  return {
    success: true,
    model: modelInfo(session),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: availableThinkingLevels(session),
    contextUsage: contextUsage(session),
  };
}

function snapshotState(runtime: ActiveRuntime): PiRuntimeStateResult {
  const session = runtime.runtime.session;
  return {
    sessionId: session.sessionId,
    cwd: runtime.cwd,
    generation: runtime.generation,
    model: modelInfo(session),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: availableThinkingLevels(session),
    isStreaming: session.isStreaming,
    messages: session.messages as unknown[],
    messageEntryIds: messageEntryIds(session),
    sessionFile: session.sessionFile,
    contextUsage: contextUsage(session),
    branchSummarySkipPrompt: runtime.runtime.services.settingsManager.getBranchSummarySkipPrompt(),
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
    runtime.runtime.session.messages as unknown[],
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
function workspaceBoundaryExtension(pi: ExtensionAPI): void {
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

function bridgeSessionEvents(runtime: ActiveRuntime): void {
  const session = runtime.runtime.session;
  runtime.unsubscribe = session.subscribe((piEvent) => {
    const mapped = mapPiSessionEvent(piEvent);
    if (!mapped) return;
    if (mapped.type === 'tool.execution.started') {
      rememberPreviewableFile(runtime, mapped.toolName, mapped.args);
    }
    // 防休眠挂钩（main 侧自治）：run 期间顶住休眠，重试等待保持，结束/替换解除
    if (mapped.type === 'run.started') {
      runtime.running = true;
      noteRunStarted(runtime.instanceId);
      setImmediate(() => sendHostEvent('piRuntime', 'runtimeStateChanged', {
        sessionId: runtime.sessionId,
        sessionPath: runtime.runtime.session.sessionFile,
        running: runtime.running,
      }));
    } else if (mapped.type === 'run.ended') {
      noteRunEnded(runtime.instanceId, mapped.willRetry);
      if (!mapped.willRetry) {
        runtime.running = false;
        setImmediate(() => sendHostEvent('piRuntime', 'runtimeStateChanged', {
          sessionId: runtime.sessionId,
          sessionPath: runtime.runtime.session.sessionFile,
          running: false,
        }));
      }
    }
    const envelope: PiRuntimeEventEnvelope = {
      sessionId: runtime.sessionId,
      generation: runtime.generation,
      at: Date.now(),
      event: mapped,
    };
    sendHostEvent('piRuntime', 'event', envelope);
  });
}

async function bindCurrentSession(runtime: ActiveRuntime): Promise<void> {
  const session = runtime.runtime.session;
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
        const result = await runtime.runtime.newSession(options);
        return { cancelled: result.cancelled };
      },
      fork: async (entryId, options) => {
        const result = await runtime.runtime.fork(entryId, options);
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId, options) => {
        const result = await session.navigateTree(targetId, options);
        return { cancelled: result.cancelled, editorText: result.editorText };
      },
      switchSession: async (sessionPath, options) =>
        runtime.runtime.switchSession(sessionPath, options),
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
  timingMark('runtime:create:start');
  const sdk = await loadPiSdk();
  timingMark('runtime:sdk-loaded');
  const agentDir = sdk.getAgentDir();
  // LM Studio 的原生目录包含视觉能力和真实上下文；先同步到 pi 的公开模型配置，
  // 再让 pi 创建会话服务，模型选择与图片能力判定仍完全由 pi 负责。
  await syncLmStudioModels(agentDir);
  timingMark('runtime:lmstudio-synced');
  // 扩展 spawn pi 子进程时的入口约定（Electron 里 process.argv[1] 是壳的 main.js，
  // 扩展按 CLI 假设会误 spawn 壳自身；如官方 subagent 示例）。检测到 pi 即写入。
  const piBin = detectPiEnvironment().pi.binPath;
  if (piBin) process.env.PI_CLI_PATH = piBin;
  const eventBus = sdk.createEventBus();
  // 信任状态随 factory 重跑（switchSession 换 cwd）更新；reload 的隐式信任落盘依赖它。
  const trust: { autoTrustCwd?: string } = {};
  const createFactory = async ({
    cwd: effectiveCwd,
    sessionManager,
    sessionStartEvent,
  }: {
    cwd: string;
    sessionManager: unknown;
    sessionStartEvent?: unknown;
  }) => {
    // 项目信任判定与 pi CLI（main.js createRuntime）逐项对齐：
    // 有需要门控的项目级资源且无缓存决定时，先以未信任创建 SettingsManager，
    // 再在资源加载期经 resolveProjectTrust 询问用户（pi 原生判定 + 写 ProjectTrustStore）。
    const hasTrustRequiring = sdk.hasTrustRequiringProjectResources(effectiveCwd);
    const cachedTrust = projectTrustByCwd.get(effectiveCwd);
    const shouldResolveTrust = cachedTrust === undefined && hasTrustRequiring;
    const trustStore = new sdk.ProjectTrustStore(agentDir);
    const projectTrusted = shouldResolveTrust
      ? false
      : (cachedTrust ?? (!hasTrustRequiring || trustStore.get(effectiveCwd) === true));
    // pi CLI：启动时无门控资源（默认信任）的 cwd 记下来，之后 reload 出新的门控资源时
    // 隐式落 trust=true（maybeSaveImplicitProjectTrustAfterReload），避免下次启动才突然询问。
    trust.autoTrustCwd = hasTrustRequiring ? undefined : effectiveCwd;
    const settingsManager = sdk.SettingsManager.create(effectiveCwd, agentDir, { projectTrusted });
    const trustDiagnostics: Array<{ type: 'warning'; message: string }> = [];
    const services = await sdk.createAgentSessionServices({
      cwd: effectiveCwd,
      agentDir,
      settingsManager,
      resourceLoaderReloadOptions: shouldResolveTrust
        ? {
            resolveProjectTrust: async ({ extensionsResult }) => {
              const trusted = await resolveProjectTrusted({
                cwd: effectiveCwd,
                trustStore,
                // defaultProjectTrust 读取用未降权的 SettingsManager（与 pi CLI 的
                // startupSettingsManager 对应；项目设置只在信任后才加载）。
                defaultProjectTrust: sdk.SettingsManager.create(effectiveCwd, agentDir)
                  .getDefaultProjectTrust(),
                extensionsResult,
                projectTrustContext: createShellTrustContext(effectiveCwd),
                onExtensionError: (message) => trustDiagnostics.push({ type: 'warning', message }),
              });
              projectTrustByCwd.set(effectiveCwd, trusted);
              return trusted;
            },
          }
        : undefined,
      resourceLoaderOptions: {
        eventBus,
        // 使用 pi 官方 ResourceLoader 的追加提示能力；默认系统提示和项目 AGENTS.md
        // 仍由 pi 完整保留，壳只补充当前已选择的工作区边界与服务启动约定。
        appendSystemPromptOverride: (base) => [...base, desktopWorkspaceInstructions(effectiveCwd)],
        extensionFactories: [{
          name: 'pi-desktop-workspace-boundary',
          hidden: true,
          factory: workspaceBoundaryExtension,
        }],
      },
    });
    return {
      ...(await sdk.createAgentSessionFromServices({
        services,
        sessionManager: sessionManager as never,
        sessionStartEvent: sessionStartEvent as never,
      })),
      services,
      diagnostics: [...trustDiagnostics, ...services.diagnostics],
    };
  };
  const runtime = await sdk.createAgentSessionRuntime(createFactory as never, {
    cwd,
    agentDir,
    sessionManager: sessionPath ? sdk.SessionManager.open(sessionPath) : sdk.SessionManager.create(cwd),
  });
  timingMark('runtime:session-runtime-created');
  const active_: ActiveRuntime = {
    instanceId: `runtime-${++runtimeSequence}`,
    sdk,
    runtime,
    cwd,
    sessionId: runtime.session.sessionId,
    generation: ++generationSequence,
    sessionFile: runtime.session.sessionFile,
    eventBus,
    previewableExternalFiles: new Set(),
    running: false,
    mcpStatus: null,
    trust,
    summarizingBranch: false,
    unsubscribe: () => {},
  };
  // pi-mcp-adapter 状态快照：缓存 + 转发渲染层（增强项；未装 adapter 时永远不发）
  eventBus.on(MCP_STATUS_CHANNEL, (data) => {
    active_.mcpStatus = (data ?? null) as Record<string, unknown> | null;
    if (active === active_) {
      latestMcpStatus = active_.mcpStatus;
      sendHostEvent('piMcp', 'statusChanged', { snapshot: latestMcpStatus });
    }
  });
  await bindCurrentSession(active_);
  timingMark('runtime:extensions-bound');
  restorePreviewableExternalFiles(active_);
  bridgeSessionEvents(active_);
  // Review baseline 必须在首次 run 前固定：Git 仓库固定 HEAD，非 Git 目录固定
  // 会话启动快照。失败不阻塞会话启动（面板按不可用降级）。
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
  const nextFile = runtime.runtime.session.sessionFile;
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

  const previousFile = previousActive?.runtime.session.sessionFile;
  const previousWatched = previousFile ? findWindowBySession(previousFile) !== null : false;
  if (
    previousActive
    && previousActive !== runtime
    && !previousActive.runtime.session.isStreaming
    && !previousWatched
  ) {
    disposeRuntime(previousActive);
  }
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

/** 会话替换（new/switch/fork）后的统一收尾：重绑 + 重订阅 + 通知渲染层清空。 */
export async function afterSessionReplaced(
  runtime: ActiveRuntime,
  target?: HostActionContext,
): Promise<PiRuntimeStateResult> {
  const previousActive = active;
  runtime.unsubscribe();
  // 旧会话挂起的扩展 UI 请求全部取消（渲染层同步移除对话框）
  cancelPendingUiForContext({ sessionId: runtime.sessionId, generation: runtime.generation });
  // 旧会话若在运行中被替换，其 run.ended 不会再到：兜底解除防休眠
  if (runtime.running) {
    noteRunEnded(runtime.instanceId);
    runtime.running = false;
  }
  runtime.generation = ++generationSequence;
  runtime.sessionId = runtime.runtime.session.sessionId;
  await bindCurrentSession(runtime);
  restorePreviewableExternalFiles(runtime);
  bridgeSessionEvents(runtime);
  // fork/newSession 会换新会话文件，绑定旧文件的窗口改绑到新文件，
  // 否则后续 hostInvoke 按旧路径寻址 runtime 会失败（必须在推事件前完成）
  const previousFile = runtime.sessionFile;
  const nextFile = runtime.runtime.session.sessionFile;
  runtime.sessionFile = nextFile;
  if (previousFile && nextFile && !samePath(previousFile, nextFile)) {
    if (target) rebindWindowSessionForWindow(target.sender.id, previousFile, nextFile);
    else rebindWindowSession(previousFile, nextFile);
  }
  // 主窗口发起的隔离替换要更新全局 active（侧栏 isCurrent / 无 scope 回退）；
  // 独立窗口发起时则保持主窗口 active 不变。
  if (target && isMainWindow(target.sender.id)) {
    active = runtime;
    latestMcpStatus = runtime.mcpStatus;
    sendHostEvent('piMcp', 'statusChanged', { snapshot: latestMcpStatus });
  }
  const state = snapshotState(runtime);
  if (target) sendHostEventToWebContents(target.sender, 'piRuntime', 'sessionReplaced', state);
  else sendHostEvent('piRuntime', 'sessionReplaced', state);

  const previousActiveFile = previousActive?.runtime.session.sessionFile;
  const previousActiveWatched = previousActiveFile
    ? findWindowBySession(previousActiveFile) !== null
    : false;
  if (
    previousActive &&
    previousActive !== runtime &&
    !previousActive.runtime.session.isStreaming &&
    !previousActiveWatched
  ) {
    disposeRuntime(previousActive);
  }
  return state;
}

function shouldIsolateSessionReplacement(runtime: ActiveRuntime, ctx?: HostActionContext): boolean {
  const sessionPath = runtime.runtime.session.sessionFile;
  return Boolean(sessionPath && ctx && hasSessionInOtherWindow(sessionPath, ctx.sender.id));
}

async function createReplacementRuntime(
  current: ActiveRuntime,
  ctx?: HostActionContext,
): Promise<ActiveRuntime> {
  const replacement = await createRuntime(current.cwd);
  if (ctx) await afterSessionReplaced(replacement, ctx);
  else activateSessionRuntime(replacement);
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
function treeEntrySummary(entry: SessionEntry): { kind: PiRuntimeTreeNode['kind']; text: string } | null {
  if (entry.type === 'message') {
    const role = entry.message.role;
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
  session: AgentSession,
  payload: PiRuntimeQueueItemPayload,
): Promise<string | null> {
  const steering = [...session.getSteeringMessages()];
  const followUp = [...session.getFollowUpMessages()];
  const list = payload.kind === 'steering' ? steering : followUp;
  if (payload.index < 0 || payload.index >= list.length) return null;
  const [removed] = list.splice(payload.index, 1);
  session.clearQueue();
  session.agent.clearAllQueues();
  for (const text of steering) await session.steer(text);
  for (const text of followUp) await session.followUp(text);
  return removed;
}

/**
 * 会话启动上限。超时后渲染层得到错误（可重试），底层构建继续在后台完成：
 * startInFlight 只在构建自然结束后清理，重试会复用同一个构建而不是再起一个。
 */
const START_TIMEOUT_MS = 45_000;

export const piRuntimeApi = {
  start: async (payload: PiRuntimeStartPayload, ctx?: HostActionContext): Promise<PiRuntimeStateResult> => {
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
    if (active && !samePath(active.cwd, payload.cwd) && !active.runtime.session.isStreaming) {
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
    } finally {
      clearTimeout(timer);
    }
  },

  getState: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeStateResult | null => {
    const active = resolveRuntimeForContext(ctx);
    return active ? snapshotState(active) : null;
  },

  getContextUsage: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeContextUsage | null => {
    const usage = resolveRuntimeForContext(ctx)?.runtime.session.getContextUsage();
    return usage
      ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
      : null;
  },

  getUsage: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeUsageResult | null => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return null;
    const session = active.runtime.session;
    const stats = session.getSessionStats();
    return {
      context: contextUsage(session) ?? null,
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
    const session = active.runtime.session;
    try {
      // @path 就地展开为 <file> 块（pi file-processor 语义；图片转 images 通道）
      const expanded = await expandFileReferences(payload.text, active.cwd);
      const staged = (payload.images ?? []) as unknown[];
      await session.prompt(expanded.text, {
        images: [...expanded.images, ...staged] as never,
        // 流式中提交：默认 followUp（排队等当前 run 完成），behavior='steer' 时当前轮插入
        ...(session.isStreaming
          ? { streamingBehavior: payload.behavior ?? ('followUp' as const) }
          : {}),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  queueRemove: async (payload: PiRuntimeQueueItemPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const removed = await removeQueuedItem(active.runtime.session, payload);
    return removed ? { success: true } : { success: false, error: 'queue index out of range' };
  },

  queueSteerNow: async (payload: PiRuntimeQueueItemPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.runtime.session;
    const text = await removeQueuedItem(session, payload);
    if (text == null) return { success: false, error: 'queue index out of range' };
    try {
      // 立即发送：流式中 = steer（当前轮工具间隙插入），空闲 = 直接开新轮
      if (session.isStreaming) await session.steer(text);
      else await session.prompt(text);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** stop 按钮按当前状态分发（pi TUI 的 Escape 语义）：压缩中/分支摘要中/重试等待中分别接对应 abort。 */
  abort: async (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.runtime.session;
    if (session.isBashRunning) session.abortBash();
    else if (session.isCompacting) session.abortCompaction();
    else if (active.summarizingBranch) session.abortBranchSummary();
    else if (session.isRetrying) session.abortRetry();
    else await session.abort();
    return { success: true };
  },

  newSession: async (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    // 同一会话可同时显示在多个窗口。此时不能在共享 runtime 上原地
    // newSession，否则所有窗口都会收到 sessionReplaced；只为发起窗口创建新 runtime。
    if (active.runtime.session.isStreaming || shouldIsolateSessionReplacement(active, ctx)) {
      try {
        await createReplacementRuntime(active, ctx);
        return { success: true };
      } catch (err) {
        return { success: false, error: toError(err) };
      }
    }
    await active.runtime.newSession();
    await afterSessionReplaced(active, ctx);
    bindSenderToRuntime(ctx, active);
    return { success: true };
  },

  /** 消息级 fork（TUI /fork 选消息）：position='before'，新会话不含被选消息，文本回填编辑器。 */
  fork: async (payload: PiRuntimeForkPayload, ctx?: HostActionContext): Promise<PiRuntimeForkResult> => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    if (active.runtime.session.isStreaming) return { success: false, error: 'session is streaming' };
    let forkRuntime = active;
    let isolated = false;
    try {
      // fork 也会改变 runtime 的 session file。共享会话时先从原文件创建独立
      // runtime，避免另一个窗口收到 fork 后被错误改绑。
      if (shouldIsolateSessionReplacement(active, ctx)) {
        const sessionPath = active.runtime.session.sessionFile;
        if (!sessionPath) return { success: false, error: 'session has no file' };
        forkRuntime = await createRuntime(active.cwd, sessionPath);
        isolated = true;
      }
      const result = await forkRuntime.runtime.fork(payload.entryId);
      if (result.cancelled) {
        if (isolated) disposeRuntime(forkRuntime);
        return { success: false, error: 'cancelled' };
      }
      // fork 产生新会话文件并整体替换 runtime：走既有 sessionReplaced 刷新流程
      await afterSessionReplaced(forkRuntime, ctx);
      bindSenderToRuntime(ctx, forkRuntime);
      return { success: true, selectedText: result.selectedText };
    } catch (err) {
      if (isolated) disposeRuntime(forkRuntime);
      return { success: false, error: toError(err) };
    }
  },

  getTree: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeTreeResult => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { nodes: [] };
    const sm = active.runtime.session.sessionManager;
    const leafId = sm.getLeafId();
    // 当前分支路径（leaf 及其祖先链），面板里高亮用
    const onPath = new Set<string>();
    let cursor = leafId;
    while (cursor) {
      onPath.add(cursor);
      cursor = sm.getEntry(cursor)?.parentId ?? null;
    }
    const nodes: PiRuntimeTreeNode[] = [];
    const walk = (list: SessionTreeNode[], depth: number) => {
      for (const node of list) {
        const summary = treeEntrySummary(node.entry);
        if (summary) {
          nodes.push({
            id: node.entry.id,
            depth,
            kind: summary.kind,
            text: summary.text,
            label: node.label,
            isLeaf: node.entry.id === leafId,
            onCurrentPath: onPath.has(node.entry.id),
          });
        }
        // 被跳过的节点不占用缩进深度
        walk(node.children, summary ? depth + 1 : depth);
      }
    };
    walk(sm.getTree(), 0);
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
      const result = await active.runtime.session.navigateTree(payload.targetId, {
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
      await active.runtime.session.compact(payload?.customInstructions);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** `!` bash 命令（TUI handleBashCommand 语义：扩展可经 user_bash 事件拦截执行）。 */
  executeBash: async (payload: PiRuntimeBashPayload, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const session = active.runtime.session;
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
        await session.executeBash(payload.command, undefined, {
          excludeFromContext,
          operations: eventResult?.operations,
        });
      }
      // 流式中 pi 把 bash 消息延迟到 agent_end 落盘，此刻推全量会丢流式 partial；
      // 流式场景的新消息由 run 结束后的状态刷新带出。
      if (!session.isStreaming) {
        sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      }
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
      active.runtime.session.setSessionName(name);
      // 侧栏会话列表靠 sessionReplaced / isStreaming 翻转刷新；
      // streaming 中推全量会丢 partial 消息，跳过（流结束时列表自会刷新）。
      if (payload.notify !== false && !active.runtime.session.isStreaming) {
        sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      }
      return { success: true, name: active.runtime.session.sessionManager.getSessionName() };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  /** /session：会话信息（pi handleSessionCommand 的 getSessionStats + 会话名）。 */
  getSessionInfo: (_payload?: unknown, ctx?: HostActionContext): PiRuntimeSessionInfo | null => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return null;
    const session = active.runtime.session;
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
    const session = active.runtime.session;
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
        && active.runtime.services.settingsManager.isProjectTrusted()
        && active.sdk.hasTrustRequiringProjectResources(active.cwd)
      ) {
        active.trust.autoTrustCwd = undefined;
        try {
          const trustStore = new active.sdk.ProjectTrustStore(active.sdk.getAgentDir());
          if (trustStore.get(active.cwd) === null) trustStore.set(active.cwd, true);
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
        ?? (active.runtime.session.sessionFile
          ? await sessionExportPath(active.runtime.session.sessionFile)
          : undefined);
      const exported = await active.runtime.session.exportToHtml(outputPath);
      await settingsApi.set({ key: 'lastSessionExportPath', value: exported });
      return { success: true, path: exported };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  setThinkingLevel: async (payload: { level: string }, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    active.runtime.session.setThinkingLevel(payload.level as never);
    return modelUpdate(active.runtime.session);
  },

  setModel: async (payload: { provider: string; id: string }, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { success: false, error: 'session not started' };
    const model = active.runtime.services.modelRuntime.getModel(payload.provider, payload.id);
    if (!model) return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
    await active.runtime.session.setModel(model);
    return modelUpdate(active.runtime.session);
  },

  /**
   * / 补全数据源：壳内建命令 + prompt 模板 + 扩展 registerCommand 命令 + skills。
   * 扩展命令来源与 pi autocomplete 相同（extensionRunner.getRegisteredCommands），
   * 与内建同名的被 pi 跳过/改名，对外用 invocationName（interactive-mode 同款过滤）。
   */
  getCommands: (_payload?: unknown, ctx?: HostActionContext) => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { commands: [] };
    const loader = active.runtime.services.resourceLoader;
    const prompts = loader.getPrompts().prompts.map((p) => ({
      name: p.name,
      description: p.description,
      source: `prompt:${(p.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
    }));
    const skills = loader.getSkills().skills.map((s) => ({
      name: `skill:${s.name}`,
      description: s.description,
      source: `skill:${(s.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
    }));
    const builtinNames = new Set(SHELL_BUILTIN_COMMANDS.map((c) => c.name));
    const extensionCommands = active.runtime.session.extensionRunner
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
