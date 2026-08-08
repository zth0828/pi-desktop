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
  PiRuntimeForkPayload,
  PiRuntimeForkResult,
  PiRuntimeTreeNode,
  PiRuntimeTreeResult,
  PiRuntimeNavigatePayload,
  PiRuntimeNavigateResult,
  PiUiResponsePayload,
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
import {
  cancelAllPendingUi,
  createExtensionUIContext,
  resolveUiResponse,
} from './extension-ui';

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

function snapshotState(runtime: ActiveRuntime): PiRuntimeStateResult {
  const session = runtime.runtime.session;
  const contextUsage = session.getContextUsage();
  return {
    sessionId: session.sessionId,
    cwd: runtime.cwd,
    generation: runtime.generation,
    model: session.model
      ? { provider: session.model.provider, id: session.model.id, name: session.model.name }
      : undefined,
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    messages: session.messages as unknown[],
    messageEntryIds: messageEntryIds(session),
    sessionFile: session.sessionFile,
    contextUsage: contextUsage
      ? {
          tokens: contextUsage.tokens,
          contextWindow: contextUsage.contextWindow,
          percent: contextUsage.percent,
        }
      : undefined,
  };
}

function bridgeSessionEvents(runtime: ActiveRuntime): void {
  const session = runtime.runtime.session;
  runtime.unsubscribe = session.subscribe((piEvent) => {
    const mapped = mapPiSessionEvent(piEvent);
    if (!mapped) return;
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
  // mode 用 'print'（无 TUI，与 pi 自己的 headless 模式一致）。
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
  return active_;
}

/** 会话替换（new/switch/fork）后的统一收尾：重绑 + 重订阅 + 通知渲染层清空。 */
export async function afterSessionReplaced(runtime: ActiveRuntime): Promise<PiRuntimeStateResult> {
  runtime.unsubscribe();
  // 旧会话挂起的扩展 UI 请求全部取消（渲染层同步移除对话框）
  cancelAllPendingUi();
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

export const piRuntimeApi = {
  start: async (payload: PiRuntimeStartPayload): Promise<PiRuntimeStateResult> => {
    if (active && active.cwd === payload.cwd) return snapshotState(active);
    if (startInFlight) await startInFlight.catch(() => {});
    if (active && active.cwd !== payload.cwd) {
      active.unsubscribe();
      cancelAllPendingUi();
      active.runtime.dispose();
      active = null;
    }
    startInFlight = (async () => {
      active = await createRuntime(payload.cwd);
      return snapshotState(active);
    })();
    try {
      return await startInFlight;
    } finally {
      startInFlight = null;
    }
  },

  getState: (): PiRuntimeStateResult | null => (active ? snapshotState(active) : null),

  getContextUsage: (): PiRuntimeContextUsage | null => {
    const usage = active?.runtime.session.getContextUsage();
    return usage
      ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
      : null;
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
        // 生成中提交 = steer（docs §4.1：输入框在生成中仍可提交，自动 steer）
        ...(session.isStreaming ? { streamingBehavior: 'steer' as const } : {}),
      });
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

  compact: async () => {
    if (!active) return { success: false, error: 'session not started' };
    try {
      await active.runtime.session.compact();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  setThinkingLevel: async (payload: { level: string }) => {
    if (!active) return { success: false, error: 'session not started' };
    active.runtime.session.setThinkingLevel(payload.level as never);
    return { success: true };
  },

  setModel: async (payload: { provider: string; id: string }) => {
    if (!active) return { success: false, error: 'session not started' };
    const model = active.runtime.services.modelRuntime.getModel(payload.provider, payload.id);
    if (!model) return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
    await active.runtime.session.setModel(model);
    return { success: true };
  },

  /** / 补全数据源：内置命令 + prompt 模板 + skills（docs §4.3）。 */
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
    const builtIns = [
      { name: 'new', description: 'New session', source: 'built-in' },
      { name: 'compact', description: 'Compact context', source: 'built-in' },
      { name: 'tree', description: 'Navigate session branches', source: 'built-in' },
    ];
    return { commands: [...builtIns, ...prompts, ...skills] };
  },

  /** 扩展 UI 对话框的用户响应（extension-ui.ts 里挂起的 Promise 按 requestId 配对 resolve）。 */
  uiResponse: (payload: PiUiResponsePayload) => resolveUiResponse(payload),
};
