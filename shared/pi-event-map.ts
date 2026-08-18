// pi 事件 → 壳事件契约的唯一映射点。
// pi 事件结构变化只改这一个文件。字段形状示例见
// tests/fixtures/pi-events/text-and-toolcall.json。
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type CompactionReason = 'manual' | 'threshold' | 'overflow';

export type PiCompactionUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

export type PiCompactionResult = {
  tokensBefore: number;
  estimatedTokensAfter?: number;
  usage?: PiCompactionUsage;
};

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
  | { type: 'compaction.started'; reason: CompactionReason }
  | {
      type: 'compaction.ended';
      reason: CompactionReason;
      aborted?: boolean;
      willRetry?: boolean;
      message?: string;
      result?: PiCompactionResult;
    }
  | {
      type: 'retry.started';
      attempt?: number;
      maxAttempts?: number;
      delayMs?: number;
      message?: string;
    }
  | {
      type: 'retry.ended';
      success?: boolean;
    }
  /** `!` bash 执行的流式输出（executeBash onChunk → bash_execution_update） */
  | { type: 'bash.execution.update'; delta: string };

/** Main 侧桥接时套的信封：渲染层按 generation 丢弃过期会话的事件。 */
export type PiRuntimeEventEnvelope = {
  sessionId: string;
  generation: number;
  at: number;
  event: PiChatEvent;
};

/** pi AgentSessionEvent → 壳契约。不关心的生命周期事件（turn_* 等）返回 null。 */
export function mapPiSessionEvent(value: unknown): PiChatEvent | null {
  if (!value || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string') {
    return null;
  }
  const event = value as AgentSessionEvent;
  switch (event.type) {
    case 'agent_start':
      return { type: 'run.started' };
    case 'agent_end':
      return { type: 'run.ended', willRetry: event.willRetry };
    case 'message_start':
      return { type: 'message.started', role: event.message.role };
    case 'message_update': {
      // pi keeps the canonical partial assistant message on assistantMessageEvent.partial.
      // Older/custom providers may emit an update without that payload; ignore the malformed
      // update and wait for the next complete event instead of breaking the session event bridge.
      const partial = (event.assistantMessageEvent as { partial?: unknown } | undefined)?.partial;
      return partial === undefined ? null : { type: 'assistant.partial', message: partial };
    }
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
        steering: Array.isArray(event.steering) ? [...event.steering] : [],
        followUp: Array.isArray(event.followUp) ? [...event.followUp] : [],
      };
    case 'compaction_start':
      return { type: 'compaction.started', reason: event.reason };
    case 'compaction_end': {
      const result = event.result;
      return {
        type: 'compaction.ended',
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        message: event.errorMessage,
        ...(result ? {
          result: {
            tokensBefore: result.tokensBefore,
            estimatedTokensAfter: result.estimatedTokensAfter,
            usage: result.usage ? {
              input: result.usage.input,
              output: result.usage.output,
              cacheRead: result.usage.cacheRead,
              cacheWrite: result.usage.cacheWrite,
              cost: result.usage.cost?.total ?? 0,
            } : undefined,
          },
        } : {}),
      };
    }
    case 'auto_retry_start':
      return {
        type: 'retry.started',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        message: event.errorMessage,
      };
    case 'auto_retry_end':
      return { type: 'retry.ended', success: event.success };
    case 'bash_execution_update':
      return { type: 'bash.execution.update', delta: event.delta };
    default:
      return null;
  }
}
