// pi 事件 → 壳事件契约的唯一映射点（AGENTS.md 铁律）。
// pi 事件结构变化只改这一个文件。字段形状来自录制的真实事件
// （tests/fixtures/pi-events/text-and-toolcall.json，pi 0.83.0）。
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type PiChatEvent =
  | { type: 'run.started' }
  | { type: 'run.ended'; willRetry?: boolean }
  | { type: 'message.started'; role: string }
  /** 流式中的完整 partial AssistantMessage，渲染层替换式渲染（不做 delta 累加，避免漂移） */
  | { type: 'assistant.partial'; message: unknown }
  | { type: 'message.ended'; message: unknown }
  | { type: 'tool.execution.started'; toolCallId: string; toolName: string; args?: unknown }
  | { type: 'tool.execution.updated'; toolCallId: string; toolName: string; partialResult?: unknown }
  | {
      type: 'tool.execution.completed';
      toolCallId: string;
      toolName: string;
      result?: unknown;
      isError: boolean;
    }
  | { type: 'queue.updated'; steering: string[]; followUp: string[] }
  | { type: 'compaction.started' }
  | { type: 'compaction.ended'; aborted?: boolean }
  | { type: 'retry.started'; message?: string }
  | { type: 'retry.ended' };

/** Main 侧桥接时套的信封：渲染层按 generation 丢弃过期会话的事件。 */
export type PiRuntimeEventEnvelope = {
  sessionId: string;
  generation: number;
  at: number;
  event: PiChatEvent;
};

/** pi AgentSessionEvent → 壳契约。不关心的生命周期事件（turn_* 等）返回 null。 */
export function mapPiSessionEvent(event: AgentSessionEvent): PiChatEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'run.started' };
    case 'agent_end':
      return { type: 'run.ended', willRetry: event.willRetry };
    case 'message_start':
      return { type: 'message.started', role: event.message.role };
    case 'message_update':
      return {
        type: 'assistant.partial',
        message: (event.assistantMessageEvent as { partial?: unknown }).partial,
      };
    case 'message_end':
      return { type: 'message.ended', message: event.message };
    case 'tool_execution_start':
      return {
        type: 'tool.execution.started',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case 'tool_execution_update':
      return {
        type: 'tool.execution.updated',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: event.partialResult,
      };
    case 'tool_execution_end':
      return {
        type: 'tool.execution.completed',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    case 'queue_update':
      return {
        type: 'queue.updated',
        steering: [...event.steering],
        followUp: [...event.followUp],
      };
    case 'compaction_start':
      return { type: 'compaction.started' };
    case 'compaction_end':
      return { type: 'compaction.ended', aborted: event.aborted };
    case 'auto_retry_start':
      return { type: 'retry.started', message: event.errorMessage };
    case 'auto_retry_end':
      return { type: 'retry.ended' };
    default:
      return null;
  }
}
