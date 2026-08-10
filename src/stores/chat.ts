// 聊天状态：pi 事件（经 shared/pi-event-map 映射 + generation 信封）→ 渲染状态。
// Inspired by ClawX: src/stores/chat.ts 的 reducer 思路（按 pi 事件模型重写，§5.2）。
import { create } from 'zustand';
import type { CompactionReason, PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import type {
  PiRuntimeModelInfo,
  PiRuntimeModelUpdateResult,
  PiRuntimeStateResult,
  PiUiRequestPayload,
} from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { reportRunCompleted, reportUiRequest } from '../lib/notify';
import {
  rebuildToolExecutionsFromMessages,
  type ChatMessage,
  type ContentBlock,
  type ToolExecution,
} from '../lib/chat-types';

export type { ChatMessage, ContentBlock, ToolExecution };

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
  model?: PiRuntimeModelInfo;
  thinkingLevel: string;
  availableThinkingLevels: string[];
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
  /** Review 面板（会话改动评审）开关 */
  reviewOpen: boolean;
  /** Workspace 文件预览面板开关（与 Review 共用右侧工作台）。 */
  workspaceOpen: boolean;
  /** 工具卡请求打开工作区文件（nonce 保证重复点击同一路径也能激活）。 */
  workspaceFileRequest: { path: string; nonce: number } | null;
  /** fork/跳分支后回填输入框的文本（nonce 保证同文本也触发） */
  inputDraft: { text: string; nonce: number } | null;
  /** 扩展 UI 请求队列（ctx.ui.confirm/select/input）；同一时间通常只有一个，设计上按队列 */
  uiRequests: PiUiRequestPayload[];

  start: (cwd: string) => Promise<void>;
  /** behavior：流式中提交的排队方式（默认 followUp 排队；'steer' 当前轮插入） */
  prompt: (text: string, images?: unknown[], behavior?: 'steer' | 'followUp') => Promise<void>;
  abort: () => Promise<void>;
  /** 移除一条排队消息（queue_update 事件负责刷新列表） */
  queueRemove: (kind: 'steering' | 'followUp', index: number) => Promise<void>;
  /** 排队消息「立即发送」：移出队列后 steer（流式中）或直接 prompt（空闲时） */
  queueSteerNow: (kind: 'steering' | 'followUp', index: number) => Promise<void>;
  newSession: () => Promise<void>;
  compact: () => Promise<void>;
  toggleToolsExpanded: () => void;
  setTreeOpen: (open: boolean) => void;
  setReviewOpen: (open: boolean) => void;
  setWorkspaceOpen: (open: boolean) => void;
  openWorkspaceFile: (path: string) => void;
  /** 消息级 fork：从指定 user 消息分叉新会话（sessionReplaced 事件负责刷新列表） */
  forkFrom: (entryId: string) => Promise<void>;
  /** 跳分支：同会话文件内移动 leaf（navigateTree 后 main 推全量状态刷新） */
  navigateTo: (targetId: string) => Promise<void>;
  /** 扩展 UI 对话框的用户响应：出队 + 回传 main（value 缺省 = 取消） */
  respondUi: (requestId: string, value?: string | boolean) => Promise<void>;
  applyState: (state: PiRuntimeStateResult) => void;
  applyModelUpdate: (result: PiRuntimeModelUpdateResult) => void;
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
  availableThinkingLevels: [],
  isStreaming: false,
  messages: [],
  toolExecutions: {},
  toolsExpanded: false,
  compaction: null,
  retry: null,
  queue: { steering: [], followUp: [] },
  treeOpen: false,
  reviewOpen: false,
  workspaceOpen: false,
  workspaceFileRequest: null,
  inputDraft: null,
  uiRequests: [],

  start: async (cwd) => {
    const current = get();
    if (current.starting) return;
    // 页面来回切换会重挂 ChatPage：同 cwd 的重复 start 直接忽略，
    // 否则会闪「正在启动会话…」并被 applyState 无谓重置。
    if (current.started && current.cwd === cwd) return;
    set({ starting: true, startError: undefined });
    try {
      // 兜底超时：main 侧也有自己的超时，这里防 IPC 完全无响应把页面卡死
      const state = await Promise.race([
        hostApi.piRuntime.start(cwd),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('start-timeout')), 75_000);
        }),
      ]);
      get().applyState(state);
      set({ started: true, starting: false });
    } catch (err) {
      set({ starting: false, startError: err instanceof Error ? err.message : String(err) });
    }
  },

  prompt: async (text, images, behavior) => {
    // 启动竞态：start 还在进行时（页面已可输入但 runtime 未就绪）先等它结束，
    // 否则用户秒发消息会吃到「session not started」
    for (let i = 0; i < 100 && get().starting; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = await hostApi.piRuntime.prompt(text, images, behavior);
    if (!result.success) set({ startError: result.error });
  },

  abort: async () => {
    await hostApi.piRuntime.abort();
  },

  queueRemove: async (kind, index) => {
    const result = await hostApi.piRuntime.queueRemove(kind, index);
    if (!result.success) set({ startError: result.error });
  },

  queueSteerNow: async (kind, index) => {
    const result = await hostApi.piRuntime.queueSteerNow(kind, index);
    if (!result.success) set({ startError: result.error });
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

  setReviewOpen: (open) => set({ reviewOpen: open, ...(open ? { workspaceOpen: false } : {}) }),

  setWorkspaceOpen: (open) => set({ workspaceOpen: open, ...(open ? { reviewOpen: false } : {}) }),

  openWorkspaceFile: (rawPath) => {
    const cwd = get().cwd?.replace(/\/$/, '');
    const normalized = rawPath.replace(/\\/g, '/');
    const path = cwd && normalized.startsWith(`${cwd}/`)
      ? normalized.slice(cwd.length + 1)
      : normalized;
    set({
      workspaceOpen: true,
      reviewOpen: false,
      workspaceFileRequest: { path, nonce: (get().workspaceFileRequest?.nonce ?? 0) + 1 },
    });
  },

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
    const messages = state.messages.map((m, i) => ({
      ...asMessage(m),
      entryId: state.messageEntryIds?.[i] ?? undefined,
    }));
    set({
      cwd: state.cwd,
      sessionId: state.sessionId,
      generation: state.generation,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      availableThinkingLevels: state.availableThinkingLevels ?? [],
      isStreaming: state.isStreaming,
      messages,
      // 恢复/切换会话：事件累积的执行表为空，从消息历史重建（结果 + 中断标记）
      toolExecutions: rebuildToolExecutionsFromMessages(messages),
      compaction: null,
      retry: null,
      queue: { steering: [], followUp: [] },
      uiRequests: [],
    });
  },

  applyModelUpdate: (result) => {
    if (!result.success) return;
    set((state) => ({
      model: result.model ?? state.model,
      thinkingLevel: result.thinkingLevel ?? state.thinkingLevel,
      availableThinkingLevels:
        result.availableThinkingLevels ?? state.availableThinkingLevels,
    }));
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
    const messages = state.messages.map((m) => asMessage(m));
    set({
      messages,
      toolExecutions: rebuildToolExecutionsFromMessages(messages),
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
        // 系统通知（档位/焦点判定在 main）：正文取最后一条 assistant 消息摘要
        const lastAssistant = [...get().messages]
          .reverse()
          .find((m) => m.role === 'assistant' && !m.streaming);
        const summary = (lastAssistant?.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        reportRunCompleted(summary || get().cwd || '');
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
    // 挂起的确认/输入请求也走系统通知（"需要确认/输入"类）
    reportUiRequest(req.title);
  });
  onHostEvent('piRuntime', 'uiCancel', ({ requestId }) => {
    useChatStore.setState((s) => ({
      uiRequests: s.uiRequests.filter((r) => r.requestId !== requestId),
    }));
  });
}
