// 聊天域核心类型。独立成无依赖模块：node 侧（tsconfig.node.json）的单测引用
// turn-changes 等纯函数时，不应经 stores/chat → host-api 链把 window 拖进程序。
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
