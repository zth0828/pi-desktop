// 聊天状态：pi 事件（经 shared/pi-event-map 映射 + generation 信封）→ 渲染状态。
// Inspired by ClawX: src/stores/chat.ts 的 reducer 思路（按 pi 事件模型重写）。
// createChatStore() 工厂，每面板一实例。本模块保持 node-safe（不引 react / host-events / notify，同 chat-types.ts
// 分层约定）：事件订阅入口 onEvent 与通知上报 reporters 由调用方注入，node 侧单测可直接引用。
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CompactionReason, PiCompactionResult, PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import type { HostEventArgs, HostEventModule, HostEventName } from '@shared/host-events/contract';
import type {
  HostSuccess,
  PiExtensionUiState,
  PiRuntimeUsageTurn,
  PiRuntimeModelInfo,
  PiRuntimeModelUpdateResult,
  PiRuntimeNavigateResult,
  PiRuntimeStateResult,
  PiUiRequestPayload,
} from '@shared/host-api/contract';
import { hostApi, scopedHostApi, type HostApi } from '../lib/host-api';
import { matchesBoundSession, shouldApplySessionReplaced } from '../lib/session-binding';
import { createStreamBatcher } from '../lib/stream-throttle';
import {
  rebuildToolExecutionsFromMessages,
  type ChatMessage,
  type ComposerAttachment,
  type ContentBlock,
  type ToolExecution,
} from '../lib/chat-types';

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
export type TurnStats = PiRuntimeUsageTurn & { durationMs: number };

/** host 事件订阅入口（与 lib/host-events 的 onHostEvent 同签名；web 侧传它，测试传伪总线） */
export type HostEventSubscriber = <M extends HostEventModule, E extends HostEventName<M>>(
  module: M,
  event: E,
  handler: (...args: HostEventArgs<M, E>) => void,
) => () => void;

/** 系统通知上报（web 侧传 lib/notify 的实现；文案含 i18n，故不进本模块） */
export type ChatEventReporters = {
  runCompleted: (summary: string) => void;
  uiRequest: (title: string) => void;
};

export type ChatStoreDeps = {
  /** 实例创建时订阅 piRuntime 五个事件；缺省不订阅（纯状态实例，测试用） */
  onEvent?: HostEventSubscriber;
  /** 通知上报；缺省不上报 */
  reporters?: ChatEventReporters;
};

export type ChatState = {
  started: boolean;
  starting: boolean;
  startError?: string;
  cwd?: string;
  sessionId?: string;
  /**
   * 本面板绑定的会话 id：非本面板会话的事件/状态推送按它过滤。
   * null = 尚未绑定（初始态）；start/switch/sessionReplaced 后更新。
   * 会话替换（newSession/fork 后 sessionId 会变）由 expectingReplacement 放行。
   */
  boundSessionId: string | null;
  /**
   * 本面板绑定会话的文件路径（state.sessionFile）：面板内 host 调用的 scoped 寻址键
   * （main 侧按会话文件路径匹配 runtime）。in-memory 新会话暂无文件，为 null 时回退窗口级调用。
   */
  boundSessionPath: string | null;
  /** 本面板刚发起会话替换动作，下一个 sessionReplaced 无论 sessionId 都接受并改绑 */
  expectingReplacement: boolean;
  generation: number;
  model?: PiRuntimeModelInfo;
  thinkingLevel: string;
  availableThinkingLevels: string[];
  isStreaming: boolean;
  runStartedAt: number | null;
  turnStats: TurnStats | null;
  messages: ChatMessage[];
  /** 完整当前分支，用于压缩后仍可浏览被摘要掉的历史。 */
  historyMessages: ChatMessage[];
  /** 面板级 composer 草稿，跨 ChatPane 重挂载保留，发送后显式清空。 */
  composerText: string;
  composerAttachments: ComposerAttachment[];
  toolExecutions: Record<string, ToolExecution>;
  compaction: { reason: CompactionReason } | null;
  /** 最近一次压缩结果，供状态栏展示压缩前后与摘要请求用量。 */
  lastCompaction: PiCompactionResult | null;
  retry: RetryState | null;
  queue: QueueState;
  /** pi branchSummary.skipPrompt 设置：true 时跳分支不询问摘要（TUI 同款语义） */
  branchSummarySkipPrompt: boolean;
  /** `!` bash 执行草稿（进行中的命令 + 已流式到达的输出）；正式消息落盘后清空 */
  bashDraft: { command: string; output: string; excludeFromContext: boolean } | null;
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
  /** pi 扩展可序列化 UI 快照（状态、working 文案、文本 widget）。 */
  extensionUi?: PiExtensionUiState;
  /** 压缩完成后等待 pi 重建完整分支快照；期间禁止用旧历史驱动导航。 */
  transcriptSyncing: boolean;
  /** runtime 最近一次报告的上下文用量，供压缩后的 token UI 立即过渡。 */
  contextUsage: PiRuntimeStateResult['contextUsage'] | null;

  start: (cwd: string) => Promise<void>;
  /** 切换本面板绑定的会话：main 侧同步改绑，成功后按本面板上下文重取全量状态 */
  switchSession: (path: string, cwd?: string) => Promise<HostSuccess>;
  /** behavior：流式中提交的排队方式（默认 followUp 排队；'steer' 当前轮插入） */
  prompt: (text: string, images?: unknown[], behavior?: 'steer' | 'followUp') => Promise<void>;
  /** `!cmd` bash 执行（pi executeBash；excludeFromContext 对应 `!!` 前缀） */
  runBash: (command: string, excludeFromContext: boolean) => Promise<void>;
  abort: () => Promise<void>;
  /** 移除一条排队消息（queue_update 事件负责刷新列表） */
  queueRemove: (kind: 'steering' | 'followUp', index: number) => Promise<void>;
  /** 排队消息「立即发送」：移出队列后 steer（流式中）或直接 prompt（空闲时） */
  queueSteerNow: (kind: 'steering' | 'followUp', index: number) => Promise<void>;
  newSession: () => Promise<void>;
  compact: () => Promise<void>;
  setTreeOpen: (open: boolean) => void;
  setReviewOpen: (open: boolean) => void;
  setWorkspaceOpen: (open: boolean) => void;
  openWorkspaceFile: (path: string) => void;
  setComposerText: (text: string) => void;
  setComposerAttachments: (attachments: ComposerAttachment[]) => void;
  clearInputDraft: () => void;
  /** 消息级 fork：从指定 user 消息分叉新会话（sessionReplaced 事件负责刷新列表） */
  forkFrom: (entryId: string) => Promise<void>;
  /** 跳分支：同会话文件内移动 leaf（navigateTree 后 main 推全量状态刷新） */
  navigateTo: (
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string },
  ) => Promise<PiRuntimeNavigateResult>;
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

/** 面板 chat store：zustand vanilla 实例 + dispose（退订创建时订阅的 host 事件） */
export type ChatStore = StoreApi<ChatState> & { dispose: () => void };

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

function appendOrReplaceMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (message.role === 'assistant' && last?.streaming) next[next.length - 1] = message;
  else next.push(message);
  return next;
}

/**
 * 每实例事件订阅（替代原模块级 bindChatEvents 单例）：五个 host 事件的 handler 只操作
 * 本实例的 getState/setState，过滤用 session-binding 纯函数；返回退订函数。
 */
function bindInstanceEvents(
  store: StoreApi<ChatState>,
  onEvent: HostEventSubscriber,
  reporters?: ChatEventReporters,
): () => void {
  // 流式合帧：assistant.partial / tool.execution.updated 是替换式流式事件，
  // 在 ≤50ms 窗口内合并（同类只留最新）后批量进 store；其余关键事件直透（直透前先
  // flush 积压保序）。dispose 先停 batcher，避免悬挂 flush 打到已退订的实例。
  const batcher = createStreamBatcher<PiRuntimeEventEnvelope>(
    (envelope) => store.getState().applyEnvelope(envelope),
    (envelope) => {
      const { event } = envelope;
      if (event.type === 'assistant.partial') return { kind: 'delta', key: 'assistant.partial' };
      if (event.type === 'tool.execution.updated') {
        return { kind: 'delta', key: `tool.execution.updated:${event.toolCallId}` };
      }
      return { kind: 'immediate' };
    },
  );
  const unbinds = [
    onEvent('piRuntime', 'event', (envelope) => {
      batcher.push(envelope);
    }),
    onEvent('piRuntime', 'sessionReplaced', (state) => {
      const s = store.getState();
      // 非本面板绑定会话的状态推送丢弃。本面板发起的会话替换
      // （newSession/fork 后 sessionId 会变）由 expectingReplacement 放行并改绑；
      // switch 链路在 switchSession 里已用 getState 直接应用并改绑，晚到的
      // 广播事件 sessionId 与 bound 一致，重复应用幂等。
      if (!shouldApplySessionReplaced(s.boundSessionId, state.sessionId, s.expectingReplacement, state.replacesSessionId)) return;
      s.applyState(state);
      store.setState({ boundSessionId: state.sessionId, expectingReplacement: false });
    }),
    onEvent('piRuntime', 'uiRequest', (req) => {
      const s = store.getState();
      if (!matchesBoundSession(s.boundSessionId, req.sessionId)) return; // 非本面板会话的请求丢弃
      if (req.generation !== s.generation) return; // 过期会话的请求丢弃（main 侧会兜底取消）
      store.setState({ uiRequests: [...s.uiRequests, req] });
      // 挂起的确认/输入请求也走系统通知（"需要确认/输入"类）
      reporters?.uiRequest(req.title);
    }),
    onEvent('piRuntime', 'uiCancel', ({ requestId }) => {
      store.setState((s) => ({
        uiRequests: s.uiRequests.filter((r) => r.requestId !== requestId),
      }));
    }),
    onEvent('piRuntime', 'uiState', (extensionUi) => {
      const current = store.getState();
      if (extensionUi.generation !== current.generation || extensionUi.sessionId !== current.sessionId) return;
      store.setState({ extensionUi });
    }),
  ];
  return () => {
    batcher.dispose();
    for (const unbind of unbinds) unbind();
  };
}

export function createChatStore(deps: ChatStoreDeps = {}): ChatStore {
  const store = createStore<ChatState>()((set, get) => {
    // 面板内 host 调用寻址：已绑定会话走 scoped client（信封带会话文件路径，
    // main 侧优先于窗口绑定路由到本面板 runtime）；未绑定（start 引导期 / in-memory 会话）
    // 回退窗口级 hostApi，行为同单窗口。
    const api = (): HostApi => {
      const path = get().boundSessionPath;
      return path ? scopedHostApi(path) : hostApi;
    };

    return {
      started: false,
      starting: false,
      boundSessionId: null,
      boundSessionPath: null,
      expectingReplacement: false,
      generation: 0,
      thinkingLevel: 'off',
      availableThinkingLevels: [],
      isStreaming: false,
      runStartedAt: null,
      turnStats: null,
      messages: [],
      historyMessages: [],
      composerText: '',
      composerAttachments: [],
      toolExecutions: {},
      compaction: null,
      lastCompaction: null,
      retry: null,
      queue: { steering: [], followUp: [] },
      branchSummarySkipPrompt: false,
      bashDraft: null,
      treeOpen: false,
      reviewOpen: false,
      workspaceOpen: false,
      workspaceFileRequest: null,
      inputDraft: null,
      uiRequests: [],
      extensionUi: undefined,
      transcriptSyncing: false,
      contextUsage: null,

      start: async (cwd) => {
        const current = get();
        if (current.starting) return;
        // 页面来回切换会重挂 ChatPane：同 cwd 的重复 start 直接忽略，
        // 否则会闪「正在启动会话…」并被 applyState 无谓重置。
        if (current.started && current.cwd === cwd) return;
        set({ starting: true, startError: undefined });
        try {
          // start 是引导动作（面板尚未绑定会话），走窗口级 hostApi。
          // 兜底超时：main 侧也有自己的超时，这里防 IPC 完全无响应把页面卡死
          const state = await Promise.race([
            hostApi.piRuntime.start(cwd),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('start-timeout')), 75_000);
            }),
          ]);
          get().applyState(state);
          set({ started: true, starting: false, boundSessionId: state.sessionId });
        } catch (err) {
          set({ starting: false, startError: err instanceof Error ? err.message : String(err) });
        }
      },

      switchSession: async (path, cwd) => {
        set({ starting: true, startError: undefined });
        try {
          // 用切换前的绑定寻址本面板 runtime（main 侧据此决定复用/新建/改绑）；
          // 尚未绑定（新面板 attach）时按目标路径寻址：窗口级调用会把
          // 全局 active runtime 切走，抢走别的面板正在用的会话。
          const fromPath = get().boundSessionPath;
          const result = await (fromPath ? scopedHostApi(fromPath) : scopedHostApi(path))
            .piSessions.switch(path, cwd);
          if (!result.success) {
            set({ starting: false, startError: result.error });
            return result;
          }
          // 目标即当前会话的早退路径不推事件，统一重取状态（事件晚到时 sessionId 已匹配，幂等）。
          // 注意：切换成功后本面板原 sessionFile 已失效，必须按目标路径寻址 getState，
          // 否则 main 侧按旧路径找不到 runtime，面板会卡在 starting。
          const state = await scopedHostApi(path).piRuntime.getState().catch(() => null);
          if (state) {
            get().applyState(state);
            set({ started: true, starting: false, boundSessionId: state.sessionId });
          } else {
            // 取不到状态时放行下一次 sessionReplaced 兜底
            set({ starting: false, expectingReplacement: true });
          }
          return { success: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          set({ starting: false, startError: error });
          return { success: false, error };
        }
      },

      prompt: async (text, images, behavior) => {
        // 启动竞态：start 还在进行时（页面已可输入但 runtime 未就绪）先等它结束，
        // 否则用户秒发消息会吃到「session not started」
        for (let i = 0; i < 100 && get().starting; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const result = await api().piRuntime.prompt(text, images, behavior);
        if (!result.success) set({ startError: result.error });
      },

      abort: async () => {
        await api().piRuntime.abort();
      },

      runBash: async (command, excludeFromContext) => {
        set({ bashDraft: { command, output: '', excludeFromContext } });
        const result = await api().piRuntime.executeBash({ command, excludeFromContext });
        if (!result.success) set({ bashDraft: null, startError: result.error });
        // 成功后草稿清理由两条路覆盖：非流式 main 推 sessionReplaced（applyState 清），
        // 流式中 pi 延迟落消息，run.ended 时 refreshMessages 并清。
      },

      queueRemove: async (kind, index) => {
        const result = await api().piRuntime.queueRemove(kind, index);
        if (!result.success) set({ startError: result.error });
      },

      queueSteerNow: async (kind, index) => {
        const result = await api().piRuntime.queueSteerNow(kind, index);
        if (!result.success) set({ startError: result.error });
      },

      newSession: async () => {
        // 新会话 sessionId 会变：放行随后的 sessionReplaced 并改绑
        set({ expectingReplacement: true });
        const result = await api().piRuntime.newSession();
        if (!result.success) set({ expectingReplacement: false, startError: result.error });
        // sessionReplaced 事件会带回新状态
      },

      compact: async () => {
        await api().piRuntime.compact();
      },


      setTreeOpen: (open) => set({ treeOpen: open }),

      setReviewOpen: (open) => set({ reviewOpen: open, ...(open ? { workspaceOpen: false } : {}) }),

      setWorkspaceOpen: (open) => set({ workspaceOpen: open, ...(open ? { reviewOpen: false } : {}) }),

      setComposerText: (text) => set({ composerText: text }),
      setComposerAttachments: (attachments) => set({ composerAttachments: attachments }),
      clearInputDraft: () => set({ inputDraft: null }),

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
        // fork 产生新会话（sessionId 变）：放行随后的 sessionReplaced 并改绑
        set({ expectingReplacement: true });
        const result = await api().piRuntime.fork(entryId);
        if (!result.success) {
          set({ expectingReplacement: false, startError: result.error });
          return;
        }
        // sessionReplaced 事件刷新消息列表；被选消息文本回填输入框供编辑重发
        if (result.selectedText) set({ inputDraft: { text: result.selectedText, nonce: Date.now() } });
      },

      navigateTo: async (targetId, options) => {
        const result = await api().piRuntime.navigateTree(targetId, options);
        if (!result.success) {
          // aborted（摘要被打断）由 TreeDialog 收回交互，不进错误条
          if (!result.aborted) set({ startError: result.error });
          return result;
        }
        // 目标是 user 消息时 pi 把文本退回编辑器（/tree 语义）
        if (result.editorText) set({ inputDraft: { text: result.editorText, nonce: Date.now() } });
        return result;
      },

      respondUi: async (requestId, value) => {
        set((s) => ({ uiRequests: s.uiRequests.filter((r) => r.requestId !== requestId) }));
        await api().piRuntime.uiResponse({ requestId, value, cancelled: value === undefined });
      },

      applyState: (state) => {
        const messages = state.messages.map((m, i) => ({
          ...asMessage(m),
          entryId: state.messageEntryIds?.[i] ?? undefined,
        }));
        const historyMessages = (state.historyMessages ?? state.messages).map((m, i) => ({
          ...asMessage(m),
          entryId: state.historyMessageEntryIds?.[i] ?? undefined,
        }));
        set({
          cwd: state.cwd,
          sessionId: state.sessionId,
          generation: state.generation,
          boundSessionPath: state.sessionFile ?? null,
          model: state.model,
          thinkingLevel: state.thinkingLevel,
          availableThinkingLevels: state.availableThinkingLevels ?? [],
          isStreaming: state.isStreaming,
          runStartedAt: null,
          turnStats: null,
          messages,
          historyMessages,
          // 恢复/切换会话：事件累积的执行表为空，从完整展示历史重建（结果 + 中断标记）
          toolExecutions: rebuildToolExecutionsFromMessages(historyMessages),
          compaction: null,
          lastCompaction: null,
          retry: null,
          queue: { steering: [], followUp: [] },
          bashDraft: null,
          branchSummarySkipPrompt: state.branchSummarySkipPrompt ?? false,
          uiRequests: state.pendingUiRequests ?? [],
          extensionUi: state.extensionUi,
          contextUsage: state.contextUsage ?? null,
          transcriptSyncing: false,
        });
      },

      applyModelUpdate: (result) => {
        if (!result.success) return;
        set((state) => ({
          model: result.model ?? state.model,
          thinkingLevel: result.thinkingLevel ?? state.thinkingLevel,
          availableThinkingLevels:
            result.availableThinkingLevels ?? state.availableThinkingLevels,
          contextUsage: result.contextUsage ?? state.contextUsage,
        }));
      },

      refreshEntryIds: async () => {
        const state = await api().piRuntime.getState().catch(() => null);
        if (!state || state.generation !== get().generation) return; // 会话已替换，丢弃
        // in-memory 会话首次落盘后补记 scoped 寻址键
        if (state.sessionFile && state.sessionFile !== get().boundSessionPath) {
          set({ boundSessionPath: state.sessionFile });
        }
        const ids = state.messageEntryIds ?? [];
        const historyIds = state.historyMessageEntryIds ?? [];
        const current = get();
        const historyMessages = (state.historyMessages ?? state.messages).map((m, i) => ({
          ...asMessage(m),
          entryId: historyIds[i] ?? undefined,
        }));
        set({
          messages: current.messages.map((m, i) =>
            m.entryId === (ids[i] ?? undefined) ? m : { ...m, entryId: ids[i] ?? undefined },
          ),
          historyMessages,
          toolExecutions: rebuildToolExecutionsFromMessages(historyMessages),
        });
      },

      refreshMessages: async () => {
        const state = await api().piRuntime.getState().catch(() => null);
        if (!state || state.generation !== get().generation) {
          set({ transcriptSyncing: false });
          return; // 会话已替换，丢弃
        }
        if (state.sessionFile && state.sessionFile !== get().boundSessionPath) {
          set({ boundSessionPath: state.sessionFile });
        }
        const messages = state.messages.map((m, i) => ({
          ...asMessage(m),
          entryId: state.messageEntryIds?.[i] ?? undefined,
        }));
        const historyMessages = (state.historyMessages ?? state.messages).map((m, i) => ({
          ...asMessage(m),
          entryId: state.historyMessageEntryIds?.[i] ?? undefined,
        }));
        set({
          messages,
          historyMessages,
          toolExecutions: rebuildToolExecutionsFromMessages(historyMessages),
          contextUsage: state.contextUsage ?? null,
          transcriptSyncing: false,
        });
      },

      applyEnvelope: (envelope) => {
        const s = get();
        // 非本面板绑定会话的事件丢弃（bound 为 null 的初始态保持原行为）
        if (!matchesBoundSession(s.boundSessionId, envelope.sessionId)) return;
        if (envelope.generation !== s.generation) return; // 过期会话的事件丢弃
        const { event } = envelope;
        switch (event.type) {
          case 'run.started':
            set({ isStreaming: true, runStartedAt: Date.now(), turnStats: null, retry: null, queue: { steering: [], followUp: [] } });
            break;
          case 'run.ended': {
            // 收尾：run 结束时仍在 running 的工具（abort/error 中断）标记为中断，
            // 避免工具卡永远停在 running。willRetry 时 run 会继续，不动工具状态。
            if (event.willRetry) {
              set({ isStreaming: false, retry: null });
              break;
            }
            const now = Date.now();
            const durationMs = s.runStartedAt == null ? 0 : Math.max(0, now - s.runStartedAt);
            const toolExecutions = Object.fromEntries(
              Object.entries(s.toolExecutions).map(([id, ex]) =>
                ex.status === 'running'
                  ? [id, { ...ex, status: 'error' as const, interrupted: true, endedAt: ex.endedAt ?? now }]
                  : [id, ex],
              ),
            );
            set({ isStreaming: false, runStartedAt: null, toolExecutions, retry: null });
            // 流式中执行的 bash 消息由 pi 延迟到 run 结束才落盘，此刻同步进列表
            if (get().bashDraft) {
              set({ bashDraft: null });
              void get().refreshMessages();
            }
            void api().piRuntime.getUsage().then((usage) => {
              if (usage?.latestTurn && get().generation === envelope.generation && get().runStartedAt === null && get().turnStats === null) {
                set({ turnStats: { ...usage.latestTurn, durationMs } });
              }
            }).catch(() => {});
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
            deps.reporters?.runCompleted(summary || get().cwd || '');
            break;
          }
          case 'assistant.partial': {
            const partial = asMessage(event.message, true);
            set({
              messages: appendOrReplaceMessage(s.messages, partial),
              historyMessages: appendOrReplaceMessage(s.historyMessages, partial),
            });
            break;
          }
          case 'message.ended': {
            const msg = asMessage(event.message);
            set({
              messages: appendOrReplaceMessage(s.messages, msg),
              historyMessages: appendOrReplaceMessage(s.historyMessages, msg),
            });
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
          case 'bash.execution.update': {
            const draft = s.bashDraft;
            if (draft) set({ bashDraft: { ...draft, output: draft.output + event.delta } });
            break;
          }
          case 'compaction.started':
            set({ compaction: { reason: event.reason }, lastCompaction: null });
            break;
          case 'compaction.ended': {
            if (event.aborted) {
              set({ compaction: null, transcriptSyncing: false, lastCompaction: null });
              break;
            }
            // compaction_end 只表示 pi 完成摘要请求；完整分支和新上下文
            // 仍需从 runtime 读取。保持 compaction 状态直到快照替换完成，
            // 防止旧 historyMessages 驱动导航和折叠布局。
            set({ transcriptSyncing: true, lastCompaction: event.result ?? null });
            void get().refreshMessages().then(() => {
              set({ compaction: null, transcriptSyncing: false });
            });
            break;
          }
          default:
            break;
        }
      },
    };
  });
  const dispose = deps.onEvent
    ? bindInstanceEvents(store, deps.onEvent, deps.reporters)
    : () => {};
  return Object.assign(store, { dispose });
}
