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

export type ComposerAttachment =
  | { kind: 'image'; name: string; data: string; mediaType: string; previewUrl: string }
  | { kind: 'file'; name: string; text: string };

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

/**
 * 从消息历史重建工具执行表（会话恢复/压缩刷新后 toolExecutions 为空的兜底）。
 * assistant 的 toolCall block 建 running 记录，后续 toolResult 消息补齐结果；
 * 没有 toolResult 的是历史中断调用，按 interrupted 标记（与 run.ended 收尾口径一致），
 * 否则恢复出来的旧会话工具卡会永远停在「执行中」。
 */
export function rebuildToolExecutionsFromMessages(
  messages: ChatMessage[],
): Record<string, ToolExecution> {
  const executions: Record<string, ToolExecution> = {};
  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'toolCall' && b.id) {
          executions[b.id] = {
            toolCallId: b.id,
            toolName: b.name ?? 'unknown',
            args: b.arguments,
            status: 'running',
            startedAt: m.timestamp,
          };
        }
      }
      continue;
    }
    if (m.role === 'toolResult') {
      const raw = m.raw as {
        toolCallId?: string;
        isError?: boolean;
        content?: unknown;
        details?: unknown;
      } | undefined;
      const id = raw?.toolCallId;
      const ex = id ? executions[id] : undefined;
      if (!id || !ex) continue;
      executions[id] = {
        ...ex,
        status: raw?.isError ? 'error' : 'success',
        result: { content: raw?.content ?? [], details: raw?.details },
        endedAt: m.timestamp,
      };
    }
  }
  for (const id of Object.keys(executions)) {
    const ex = executions[id];
    if (ex.status === 'running') {
      executions[id] = { ...ex, status: 'error', interrupted: true, endedAt: ex.startedAt };
    }
  }
  return executions;
}
