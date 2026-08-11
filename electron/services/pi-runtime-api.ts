// pi 会话运行时：壳与 pi SDK 的唯一接触面之一（会话生命周期 + 事件桥）。
// 事件映射在 shared/pi-event-map.ts（单点）。会话替换（new/switch/fork）后
// 必须重新 subscribe + bindExtensions（SDK 约定，见 docs/sdk.md）。
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
} from '@shared/host-api/contract';
import type {
  AgentSession,
  AgentSessionRuntime,
  EventBus,
  SessionEntry,
  SessionTreeNode,
} from '@earendil-works/pi-coding-agent';
import { sendHostEvent } from '../main/ipc/host-events';
import { expandFileReferences } from '../utils/file-expand';
import { detectPiEnvironment } from '../utils/pi-detector';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';
import { samePath } from '../utils/same-path';
import { syncLmStudioModels } from '../utils/lmstudio-models';
import { sessionExportPath } from '../utils/session-export';
import {
  cancelAllPendingUi,
  createExtensionUIContext,
  getExtensionUiStateSnapshot,
  resetExtensionUiState,
  resolveUiResponse,
} from './extension-ui';
import { captureReviewBaseline, clearReviewBaseline } from './review-api';
import { noteRunEnded, noteRunStarted } from './power-save';
import { settingsApi } from './settings-api';

export type ActiveRuntime = {
  sdk: PiSdk;
  runtime: AgentSessionRuntime;
  cwd: string;
  sessionId: string;
  generation: number;
  /** 传给 resourceLoader 的事件总线（pi-mcp-adapter 等扩展的状态通道挂在上面） */
  eventBus: EventBus;
  unsubscribe: () => void;
};

/** pi-mcp-adapter 的版本化状态通道（docs §4.7 Spike B 结论）。 */
export const MCP_STATUS_CHANNEL = 'pi-mcp-adapter/status/v1';

let active: ActiveRuntime | null = null;
let startInFlight: Promise<PiRuntimeStateResult> | null = null;
let latestMcpStatus: Record<string, unknown> | null = null;

/** 当前活动运行时（供 piSessions 等兄弟服务复用；只读使用，替换会话须走 afterSessionReplaced）。 */
export function getActiveRuntime(): ActiveRuntime | null {
  return active;
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
    extensionUi: getExtensionUiStateSnapshot({
      sessionId: runtime.sessionId,
      generation: runtime.generation,
    }),
  };
}

function bridgeSessionEvents(runtime: ActiveRuntime): void {
  const session = runtime.runtime.session;
  runtime.unsubscribe = session.subscribe((piEvent) => {
    const mapped = mapPiSessionEvent(piEvent);
    if (!mapped) return;
    // 防休眠挂钩（main 侧自治）：run 期间顶住休眠，重试等待保持，结束/替换解除
    if (mapped.type === 'run.started') noteRunStarted();
    else if (mapped.type === 'run.ended') noteRunEnded(mapped.willRetry);
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
  // Spike B 结论：不调 bindExtensions 扩展收不到 session_start（MCP 等全部失效）。
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

async function createRuntime(cwd: string): Promise<ActiveRuntime> {
  const sdk = await loadPiSdk();
  const agentDir = sdk.getAgentDir();
  // LM Studio 的原生目录包含视觉能力和真实上下文；先同步到 pi 的公开模型配置，
  // 再让 pi 创建会话服务，模型选择与图片能力判定仍完全由 pi 负责。
  await syncLmStudioModels(agentDir);
  // 扩展 spawn pi 子进程时的入口约定（Electron 里 process.argv[1] 是壳的 main.js，
  // 扩展按 CLI 假设会误 spawn 壳自身；如官方 subagent 示例）。检测到 pi 即写入。
  const piBin = detectPiEnvironment().pi.binPath;
  if (piBin) process.env.PI_CLI_PATH = piBin;
  const eventBus = sdk.createEventBus();
  const createFactory = async ({
    cwd: effectiveCwd,
    sessionManager,
    sessionStartEvent,
  }: {
    cwd: string;
    sessionManager: unknown;
    sessionStartEvent?: unknown;
  }) => {
    const services = await sdk.createAgentSessionServices({
      cwd: effectiveCwd,
      agentDir,
      resourceLoaderOptions: { eventBus },
    });
    return {
      ...(await sdk.createAgentSessionFromServices({
        services,
        sessionManager: sessionManager as never,
        sessionStartEvent: sessionStartEvent as never,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  const runtime = await sdk.createAgentSessionRuntime(createFactory as never, {
    cwd,
    agentDir,
    sessionManager: sdk.SessionManager.create(cwd),
  });
  const active_: ActiveRuntime = {
    sdk,
    runtime,
    cwd,
    sessionId: runtime.session.sessionId,
    generation: 1,
    eventBus,
    unsubscribe: () => {},
  };
  // pi-mcp-adapter 状态快照：缓存 + 转发渲染层（增强项；未装 adapter 时永远不发）
  latestMcpStatus = null;
  eventBus.on(MCP_STATUS_CHANNEL, (data) => {
    latestMcpStatus = (data ?? null) as Record<string, unknown> | null;
    sendHostEvent('piMcp', 'statusChanged', { snapshot: latestMcpStatus });
  });
  await bindCurrentSession(active_);
  bridgeSessionEvents(active_);
  // Review baseline 必须在首次 run 前固定：Git 仓库固定 HEAD，非 Git 目录固定
  // 会话启动快照。失败不阻塞会话启动（面板按不可用降级）。
  await captureReviewBaseline(cwd);
  return active_;
}

/** 会话替换（new/switch/fork）后的统一收尾：重绑 + 重订阅 + 通知渲染层清空。 */
export async function afterSessionReplaced(runtime: ActiveRuntime): Promise<PiRuntimeStateResult> {
  runtime.unsubscribe();
  // 旧会话挂起的扩展 UI 请求全部取消（渲染层同步移除对话框）
  cancelAllPendingUi();
  // 旧会话若在运行中被替换，其 run.ended 不会再到：兜底解除防休眠
  noteRunEnded();
  runtime.generation += 1;
  runtime.sessionId = runtime.runtime.session.sessionId;
  await bindCurrentSession(runtime);
  bridgeSessionEvents(runtime);
  const state = snapshotState(runtime);
  sendHostEvent('piRuntime', 'sessionReplaced', state);
  return state;
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
  start: async (payload: PiRuntimeStartPayload): Promise<PiRuntimeStateResult> => {
    // samePath：/tmp ↔ /private/tmp 等形式差异不应触发无谓的 runtime 重建
    if (active && samePath(active.cwd, payload.cwd)) return snapshotState(active);
    if (startInFlight) await startInFlight.catch(() => {});
    // 等完上一个构建后复看：可能恰好就是目标 cwd（如超时后的重试）
    if (active && samePath(active.cwd, payload.cwd)) return snapshotState(active);
    if (active && !samePath(active.cwd, payload.cwd)) {
      active.unsubscribe();
      cancelAllPendingUi();
      active.runtime.dispose();
      active = null;
      // cwd 切换 = 新 review 上下文，旧 baseline 作废（createRuntime 会重建）
      clearReviewBaseline();
      // 运行时销毁：旧 run 的 ended 事件不再可达，兜底解除防休眠
      noteRunEnded();
    }
    const flight = (async () => {
      active = await createRuntime(payload.cwd);
      return snapshotState(active);
    })();
    startInFlight = flight;
    // 构建自然结束（成功或失败）后清理 in-flight 标记；超时不清理（见上方注释）
    void flight.catch(() => {}).then(() => {
      if (startInFlight === flight) startInFlight = null;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        flight,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('start-timeout')), START_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  },

  getState: (): PiRuntimeStateResult | null => (active ? snapshotState(active) : null),

  getContextUsage: (): PiRuntimeContextUsage | null => {
    const usage = active?.runtime.session.getContextUsage();
    return usage
      ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
      : null;
  },

  getUsage: (): PiRuntimeUsageResult | null => {
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

  prompt: async (payload: PiRuntimePromptPayload) => {
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

  queueRemove: async (payload: PiRuntimeQueueItemPayload) => {
    if (!active) return { success: false, error: 'session not started' };
    const removed = await removeQueuedItem(active.runtime.session, payload);
    return removed ? { success: true } : { success: false, error: 'queue index out of range' };
  },

  queueSteerNow: async (payload: PiRuntimeQueueItemPayload) => {
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

  abort: async () => {
    if (!active) return { success: false, error: 'session not started' };
    await active.runtime.session.abort();
    return { success: true };
  },

  newSession: async () => {
    if (!active) return { success: false, error: 'session not started' };
    await active.runtime.newSession();
    await afterSessionReplaced(active);
    return { success: true };
  },

  /** 消息级 fork（TUI /fork 选消息）：position='before'，新会话不含被选消息，文本回填编辑器。 */
  fork: async (payload: PiRuntimeForkPayload): Promise<PiRuntimeForkResult> => {
    if (!active) return { success: false, error: 'session not started' };
    if (active.runtime.session.isStreaming) return { success: false, error: 'session is streaming' };
    try {
      const result = await active.runtime.fork(payload.entryId);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      // fork 产生新会话文件并整体替换 runtime：走既有 sessionReplaced 刷新流程
      await afterSessionReplaced(active);
      return { success: true, selectedText: result.selectedText };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  getTree: (): PiRuntimeTreeResult => {
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
  navigateTree: async (payload: PiRuntimeNavigatePayload): Promise<PiRuntimeNavigateResult> => {
    if (!active) return { success: false, error: 'session not started' };
    try {
      const result = await active.runtime.session.navigateTree(payload.targetId);
      if (result.cancelled) return { success: false, error: 'cancelled' };
      sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      return { success: true, editorText: result.editorText };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  compact: async (payload?: PiRuntimeCompactPayload) => {
    if (!active) return { success: false, error: 'session not started' };
    try {
      await active.runtime.session.compact(payload?.customInstructions);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** /name <text>：重命名当前会话（pi session.setSessionName，返回值是规范化后的名字）。 */
  setSessionName: async (payload: { name: string; notify?: boolean }) => {
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
  getSessionInfo: (): PiRuntimeSessionInfo | null => {
    if (!active) return null;
    const session = active.runtime.session;
    const stats = session.getSessionStats();
    return {
      name: session.sessionManager.getSessionName(),
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
  reload: async () => {
    if (!active) return { success: false, error: 'session not started' };
    const session = active.runtime.session;
    // pi /reload：生成中/压缩中禁止
    if (session.isStreaming) return { success: false, error: 'session is streaming' };
    if (session.isCompacting) return { success: false, error: 'session is compacting' };
    try {
      resetExtensionUiState({ sessionId: active.sessionId, generation: active.generation });
      await session.reload();
      // TUI /reload 后 rebuildChatFromMessages + 重建补全源；壳推全量状态（渲染层重取命令列表）
      sendHostEvent('piRuntime', 'sessionReplaced', snapshotState(active));
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  /** /export [path]：导出当前会话 HTML；缺省统一落到 Pi Desktop 的系统文档目录。 */
  exportHtml: async (payload?: PiRuntimeExportPayload): Promise<PiSessionExportResult> => {
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

  setThinkingLevel: async (payload: { level: string }) => {
    if (!active) return { success: false, error: 'session not started' };
    active.runtime.session.setThinkingLevel(payload.level as never);
    return modelUpdate(active.runtime.session);
  },

  setModel: async (payload: { provider: string; id: string }) => {
    if (!active) return { success: false, error: 'session not started' };
    const model = active.runtime.services.modelRuntime.getModel(payload.provider, payload.id);
    if (!model) return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
    await active.runtime.session.setModel(model);
    return modelUpdate(active.runtime.session);
  },

  /**
   * / 补全数据源：壳内建命令 + prompt 模板 + 扩展 registerCommand 命令 + skills（docs §4.3）。
   * 扩展命令来源与 pi autocomplete 相同（extensionRunner.getRegisteredCommands），
   * 与内建同名的被 pi 跳过/改名，对外用 invocationName（interactive-mode 同款过滤）。
   */
  getCommands: () => {
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
