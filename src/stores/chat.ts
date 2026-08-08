// 聊天状态：pi 事件（经 shared/pi-event-map 映射 + generation 信封）→ 渲染状态。
// Inspired by ClawX: src/stores/chat.ts 的 reducer 思路（按 pi 事件模型重写，§5.2）。
import { create } from 'zustand';
import type { CompactionReason, PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import type { PiRuntimeStateResult, PiUiRequestPayload } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';

export type ContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

export type ChatMessage = {
  role: string;
  content: ContentBlock[];
  streaming?: boolean;
  timestamp?: number;
  /** 会话 entry id（仅 user 消息有，来自 state.messageEntryIds 对齐）；消息级 fork 的目标 */
  entryId?: string;
  raw: unknown;
};

export type ToolExecution = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  status: 'running' | 'success' | 'error';
  result?: unknown;
  partialResult?: unknown;
  /** 执行开始/结束时间戳（用于 Took X.Xs） */
  startedAt?: number;
  endedAt?: number;
  /** run 结束（abort/error）时仍在 running，被收尾标记为中断 */
  interrupted?: boolean;
};

function asMessage(raw: unknown, streaming = false): ChatMessage {
  const m = raw as { role?: string; content?: unknown; timestamp?: number };
  return {
    role: m.role ?? 'assistant',
    content: Array.isArray(m.content) ? (m.content as ContentBlock[]) : [],
    streaming,
    timestamp: m.timestamp,
    raw,
  };
}

/** 自动重试状态（auto_retry_start；startedAt 用于按 delayMs 本地倒计时） */
export type RetryState = {
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  startedAt: number;
};

/** steer/followUp 排队快照（queue_update 透传） */
export type QueueState = { steering: string[]; followUp: string[] };

type ChatState = {
  started: boolean;
  starting: boolean;
  startError?: string;
  cwd?: string;
  sessionId?: string;
  generation: number;
  model?: { provider: string; id: string; name?: string };
  thinkingLevel: string;
  isStreaming: boolean;
  messages: ChatMessage[];
  toolExecutions: Record<string, ToolExecution>;
  /** 全局展开/折叠所有工具卡片（卡片仍可单独点击覆盖） */
  toolsExpanded: boolean;
  compaction: { reason: CompactionReason } | null;
  retry: RetryState | null;
  queue: QueueState;
  /** 分支树面板（/tree）开关 */
  treeOpen: boolean;
  /** fork/跳分支后回填输入框的文本（nonce 保证同文本也触发） */
  inputDraft: { text: string; nonce: number } | null;
  /** 扩展 UI 请求队列（ctx.ui.confirm/select/input）；同一时间通常只有一个，设计上按队列 */
  uiRequests: PiUiRequestPayload[];

  start: (cwd: string) => Promise<void>;
  prompt: (text: string, images?: unknown[]) => Promise<void>;
  abort: () => Promise<void>;
  newSession: () => Promise<void>;
  compact: () => Promise<void>;
  toggleToolsExpanded: () => void;
  setTreeOpen: (open: boolean) => void;
  /** 消息级 fork：从指定 user 消息分叉新会话（sessionReplaced 事件负责刷新列表） */
  forkFrom: (entryId: string) => Promise<void>;
  /** 跳分支：同会话文件内移动 leaf（navigateTree 后 main 推全量状态刷新） */
  navigateTo: (targetId: string) => Promise<void>;
  /** 扩展 UI 对话框的用户响应：出队 + 回传 main（value 缺省 = 取消） */
  respondUi: (requestId: string, value?: string | boolean) => Promise<void>;
  applyState: (state: PiRuntimeStateResult) => void;
  applyEnvelope: (envelope: PiRuntimeEventEnvelope) => void;
  /** compaction 后从 runtime 重读 session 消息（pi 已重建上下文，本地事件累积列表失效） */
  refreshMessages: () => Promise<void>;
  /** run 结束后补齐 entryId（事件累积的消息不带，fork 按钮依赖它） */
  refreshEntryIds: () => Promise<void>;
};

export const useChatStore = create<ChatState>((set, get) => ({
  started: false,
  starting: false,
  generation: 0,
  thinkingLevel: 'off',
  isStreaming: false,
  messages: [],
  toolExecutions: {},
  toolsExpanded: false,
  compaction: null,
  retry: null,
  queue: { steering: [], followUp: [] },
  treeOpen: false,
  inputDraft: null,
  uiRequests: [],

  start: async (cwd) => {
    if (get().starting) return;
    set({ starting: true, startError: undefined });
    try {
      const state = await hostApi.piRuntime.start(cwd);
      get().applyState(state);
      set({ started: true, starting: false });
    } catch (err) {
      set({ starting: false, startError: err instanceof Error ? err.message : String(err) });
    }
  },

  prompt: async (text, images) => {
    const result = await hostApi.piRuntime.prompt(text, images);
    if (!result.success) set({ startError: result.error });
  },

  abort: async () => {
    await hostApi.piRuntime.abort();
  },

  newSession: async () => {
    await hostApi.piRuntime.newSession();
    // sessionReplaced 事件会带回新状态
  },

  compact: async () => {
    await hostApi.piRuntime.compact();
  },

  toggleToolsExpanded: () => set((s) => ({ toolsExpanded: !s.toolsExpanded })),

  setTreeOpen: (open) => set({ treeOpen: open }),

  forkFrom: async (entryId) => {
    const result = await hostApi.piRuntime.fork(entryId);
    if (!result.success) {
      set({ startError: result.error });
      return;
    }
    // sessionReplaced 事件刷新消息列表；被选消息文本回填输入框供编辑重发
    if (result.selectedText) set({ inputDraft: { text: result.selectedText, nonce: Date.now() } });
  },

  navigateTo: async (targetId) => {
    const result = await hostApi.piRuntime.navigateTree(targetId);
    if (!result.success) {
      set({ startError: result.error });
      return;
    }
    // 目标是 user 消息时 pi 把文本退回编辑器（/tree 语义）
    if (result.editorText) set({ inputDraft: { text: result.editorText, nonce: Date.now() } });
  },

  respondUi: async (requestId, value) => {
    set((s) => ({ uiRequests: s.uiRequests.filter((r) => r.requestId !== requestId) }));
    await hostApi.piRuntime.uiResponse({ requestId, value, cancelled: value === undefined });
  },

  applyState: (state) => {
    set({
      cwd: state.cwd,
      sessionId: state.sessionId,
      generation: state.generation,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      isStreaming: state.isStreaming,
      messages: state.messages.map((m, i) => ({
        ...asMessage(m),
        entryId: state.messageEntryIds?.[i] ?? undefined,
      })),
      toolExecutions: {},
      compaction: null,
      retry: null,
      queue: { steering: [], followUp: [] },
      uiRequests: [],
    });
  },

  refreshEntryIds: async () => {
    const state = await hostApi.piRuntime.getState().catch(() => null);
    if (!state || state.generation !== get().generation) return; // 会话已替换，丢弃
    const ids = state.messageEntryIds ?? [];
    set({
      messages: get().messages.map((m, i) =>
        m.entryId === (ids[i] ?? undefined) ? m : { ...m, entryId: ids[i] ?? undefined },
      ),
    });
  },

  refreshMessages: async () => {
    const state = await hostApi.piRuntime.getState().catch(() => null);
    if (!state || state.generation !== get().generation) return; // 会话已替换，丢弃
    set({
      messages: state.messages.map((m) => asMessage(m)),
      toolExecutions: {},
    });
  },

  applyEnvelope: (envelope) => {
    const s = get();
    if (envelope.generation !== s.generation) return; // 过期会话的事件丢弃
    const { event } = envelope;
    switch (event.type) {
      case 'run.started':
        set({ isStreaming: true, retry: null, queue: { steering: [], followUp: [] } });
        break;
      case 'run.ended': {
        // 收尾：run 结束时仍在 running 的工具（abort/error 中断）标记为中断，
        // 避免工具卡永远停在 running。willRetry 时 run 会继续，不动工具状态。
        if (event.willRetry) {
          set({ isStreaming: false, retry: null });
          break;
        }
        const now = Date.now();
        const toolExecutions = Object.fromEntries(
          Object.entries(s.toolExecutions).map(([id, ex]) =>
            ex.status === 'running'
              ? [id, { ...ex, status: 'error' as const, interrupted: true, endedAt: ex.endedAt ?? now }]
              : [id, ex],
          ),
        );
        set({ isStreaming: false, toolExecutions, retry: null });
        // 事件累积的新消息没有 entryId，从 runtime 对齐补齐（fork 按钮依赖）
        void get().refreshEntryIds();
        break;
      }
      case 'assistant.partial': {
        const partial = asMessage(event.message, true);
        const messages = [...s.messages];
        const last = messages[messages.length - 1];
        if (last?.streaming) messages[messages.length - 1] = partial;
        else messages.push(partial);
        set({ messages });
        break;
      }
      case 'message.ended': {
        const msg = asMessage(event.message);
        const messages = [...s.messages];
        const last = messages[messages.length - 1];
        if (msg.role === 'assistant' && last?.streaming) {
          messages[messages.length - 1] = msg;
        } else {
          messages.push(msg);
        }
        set({ messages });
        break;
      }
      case 'tool.execution.started':
        set({
          toolExecutions: {
            ...s.toolExecutions,
            [event.toolCallId]: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              status: 'running',
              startedAt: Date.now(),
            },
          },
        });
        break;
      case 'tool.execution.updated': {
        const prev = s.toolExecutions[event.toolCallId];
        if (!prev) break;
        set({
          toolExecutions: {
            ...s.toolExecutions,
            [event.toolCallId]: { ...prev, partialResult: event.partialResult },
          },
        });
        break;
      }
      case 'tool.execution.completed': {
        const prev = s.toolExecutions[event.toolCallId];
        if (!prev) break;
        set({
          toolExecutions: {
            ...s.toolExecutions,
            [event.toolCallId]: {
              ...prev,
              status: event.isError ? 'error' : 'success',
              result: event.result,
              endedAt: Date.now(),
            },
          },
        });
        break;
      }
      case 'queue.updated':
        set({ queue: { steering: event.steering, followUp: event.followUp } });
        break;
      case 'retry.started':
        set({
          retry: {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.message,
            startedAt: Date.now(),
          },
        });
        break;
      case 'retry.ended':
        set({ retry: null });
        break;
      case 'compaction.started':
        set({ compaction: { reason: event.reason } });
        break;
      case 'compaction.ended': {
        set({ compaction: null });
        // compaction 重建了 pi 侧上下文（summary + 保留尾部），本地事件累积的
        // 消息列表已不一致；非 abort 时从 runtime 重读（对齐 TUI 重建消息列表）。
        if (!event.aborted) void get().refreshMessages();
        break;
      }
      default:
        break;
    }
  },
}));

let bound = false;
export function bindChatEvents(): void {
  if (bound) return;
  bound = true;
  onHostEvent('piRuntime', 'event', (envelope) => {
    useChatStore.getState().applyEnvelope(envelope);
  });
  onHostEvent('piRuntime', 'sessionReplaced', (state) => {
    useChatStore.getState().applyState(state);
  });
  onHostEvent('piRuntime', 'uiRequest', (req) => {
    const s = useChatStore.getState();
    if (req.generation !== s.generation) return; // 过期会话的请求丢弃（main 侧会兜底取消）
    useChatStore.setState({ uiRequests: [...s.uiRequests, req] });
  });
  onHostEvent('piRuntime', 'uiCancel', ({ requestId }) => {
    useChatStore.setState((s) => ({
      uiRequests: s.uiRequests.filter((r) => r.requestId !== requestId),
    }));
  });
}
