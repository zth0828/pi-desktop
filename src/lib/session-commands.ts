import type { ChatMessage, ToolExecution } from './chat-types';
import { cleanBashCommand, extractResultText, formatDuration } from './tool-display';

export type CommandSource = 'agent' | 'user';
export type CommandRunStatus = 'running' | 'success' | 'error' | 'interrupted';
export type CommandFilter = 'all' | 'failed' | 'agent' | 'user';

export interface SessionCommandItem {
  /** 唯一标识：Agent 命令使用 toolCallId，用户命令使用 entryId 或唯一前缀 */
  id: string;
  /** 来源类型：Agent 自主调用 vs 用户手动执行 */
  source: CommandSource;
  /** 完整命令内容 */
  command: string;
  /** 提取首行并剥离多余工作区前缀的紧凑摘要 */
  summary: string;
  /** 执行状态 */
  status: CommandRunStatus;
  /** 终端输出（stdout/stderr 或 partialResult） */
  output?: string;
  /** 退出码（如有） */
  exitCode?: number;
  /** 开始与结束时间戳 */
  startedAt?: number;
  endedAt?: number;
  /** 格式化耗时（如 1.2s） */
  duration?: string;
  /** 用户命令特有：是否排除在 LLM 上下文之外 (!!) */
  excludeFromContext?: boolean;
  /** 聊天卡片锚点 ID（供 Jump to Chat 定位） */
  chatAnchorId?: string;
}

export type BashDraft = {
  command: string;
  output: string;
  excludeFromContext: boolean;
} | null;

/**
 * 聚合会话中的所有命令执行记录（用户手动命令 + Agent 调用的 Bash 工具）。
 * 按开始时间降序排列（运行中的置顶）。
 */
export function collectSessionCommands(
  toolExecutions: Record<string, ToolExecution> | undefined,
  historyMessages: ChatMessage[] | undefined,
  bashDraft?: BashDraft,
): SessionCommandItem[] {
  const items: SessionCommandItem[] = [];

  // 1. 正在运行的用户命令（bashDraft）
  if (bashDraft && bashDraft.command.trim()) {
    items.push({
      id: 'user-draft-running',
      source: 'user',
      command: bashDraft.command,
      summary: cleanBashCommand(bashDraft.command),
      status: 'running',
      output: bashDraft.output,
      excludeFromContext: bashDraft.excludeFromContext,
      startedAt: Date.now(),
    });
  }

  // 2. 历史用户命令（historyMessages 中 role === 'bashExecution'）
  if (historyMessages) {
    historyMessages.forEach((msg, index) => {
      if (msg.role !== 'bashExecution') return;
      const raw = msg.raw as {
        command?: string;
        output?: string;
        exitCode?: number;
        cancelled?: boolean;
        excludeFromContext?: boolean;
        timestamp?: number;
      } | undefined;
      const command = raw?.command || '';
      if (!command.trim()) return;

      const isCancelled = raw?.cancelled === true;
      const isError = raw?.exitCode !== undefined && raw.exitCode !== 0;
      const status: CommandRunStatus = isCancelled
        ? 'interrupted'
        : isError
          ? 'error'
          : 'success';

      const startedAt = msg.timestamp ?? raw?.timestamp;
      items.push({
        id: msg.entryId ? `user-cmd-${msg.entryId}` : `user-cmd-${index}-${startedAt ?? 0}`,
        source: 'user',
        command,
        summary: cleanBashCommand(command),
        status,
        output: raw?.output,
        exitCode: raw?.exitCode,
        startedAt,
        excludeFromContext: raw?.excludeFromContext,
        chatAnchorId: `chat-msg-${index}`,
      });
    });
  }

  // 3. Agent 调用的 bash 工具（toolExecutions 中 toolName === 'bash'）
  if (toolExecutions) {
    for (const execution of Object.values(toolExecutions)) {
      if (execution.toolName !== 'bash') continue;
      const args = execution.args as { command?: string } | undefined;
      const command = args?.command || '';
      if (!command.trim()) continue;

      let status: CommandRunStatus = 'success';
      if (execution.interrupted) {
        status = 'interrupted';
      } else if (execution.status === 'running') {
        status = 'running';
      } else if (execution.status === 'error') {
        status = 'error';
      }

      const output =
        execution.status === 'running' && execution.partialResult !== undefined
          ? extractResultText(execution.partialResult)
          : extractResultText(execution.result);

      // 尝试解析 exitCode
      let exitCode: number | undefined;
      if (status === 'success') {
        exitCode = 0;
      } else if (status === 'error') {
        const exitMatch = output.match(/Command exited with code (\d+)/);
        if (exitMatch) {
          exitCode = parseInt(exitMatch[1], 10);
        } else {
          exitCode = 1;
        }
      }

      const duration = formatDuration(execution.startedAt, execution.endedAt) ?? undefined;

      items.push({
        id: `agent-tool-${execution.toolCallId}`,
        source: 'agent',
        command,
        summary: cleanBashCommand(command),
        status,
        output: output || undefined,
        exitCode,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        duration,
        chatAnchorId: `tool-call-${execution.toolCallId}`,
      });
    }
  }

  // 4. 排序：运行中的置顶，其余按 startedAt 降序
  items.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    const timeA = a.startedAt ?? 0;
    const timeB = b.startedAt ?? 0;
    return timeB - timeA;
  });

  return items;
}
