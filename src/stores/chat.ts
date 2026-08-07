// 聊天状态：pi 事件（经 shared/pi-event-map 映射 + generation 信封）→ 渲染状态。
// Inspired by ClawX: src/stores/chat.ts 的 reducer 思路（按 pi 事件模型重写，§5.2）。
import { create } from 'zustand';
import type { CompactionReason, PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import type { PiRuntimeStateResult } from '@shared/host-api/contract';
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

  start: (cwd: string) => Promise<void>;
  prompt: (text: string, images?: unknown[]) => Promise<void>;
  abort: () => Promise<void>;
  newSession: () => Promise<void>;
  compact: () => Promise<void>;
  toggleToolsExpanded: () => void;
  applyState: (state: PiRuntimeStateResult) => void;
  applyEnvelope: (envelope: PiRuntimeEventEnvelope) => void;
  /** compaction 后从 runtime 重读 session 消息（pi 已重建上下文，本地事件累积列表失效） */
  refreshMessages: () => Promise<void>;
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

  applyState: (state) => {
    set({
      cwd: state.cwd,
      sessionId: state.sessionId,
      generation: state.generation,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      isStreaming: state.isStreaming,
      messages: state.messages.map((m) => asMessage(m)),
      toolExecutions: {},
      compaction: null,
      retry: null,
      queue: { steering: [], followUp: [] },
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
}
