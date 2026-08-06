// 聊天状态：pi 事件（经 shared/pi-event-map 映射 + generation 信封）→ 渲染状态。
// Inspired by ClawX: src/stores/chat.ts 的 reducer 思路（按 pi 事件模型重写，§5.2）。
import { create } from 'zustand';
import type { PiRuntimeEventEnvelope } from '@shared/pi-event-map';
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
  compacting: boolean;

  start: (cwd: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  newSession: () => Promise<void>;
  compact: () => Promise<void>;
  applyState: (state: PiRuntimeStateResult) => void;
  applyEnvelope: (envelope: PiRuntimeEventEnvelope) => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  started: false,
  starting: false,
  generation: 0,
  thinkingLevel: 'off',
  isStreaming: false,
  messages: [],
  toolExecutions: {},
  compacting: false,

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

  prompt: async (text) => {
    const result = await hostApi.piRuntime.prompt(text);
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
    });
  },

  applyEnvelope: (envelope) => {
    const s = get();
    if (envelope.generation !== s.generation) return; // 过期会话的事件丢弃
    const { event } = envelope;
    switch (event.type) {
      case 'run.started':
        set({ isStreaming: true });
        break;
      case 'run.ended':
        set({ isStreaming: false });
        break;
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
            },
          },
        });
        break;
      }
      case 'compaction.started':
        set({ compacting: true });
        break;
      case 'compaction.ended':
        set({ compacting: false });
        break;
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
