// pi raw events are normalized here and nowhere else. Renderer receives only this contract.
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

export type PiDesktopMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; data?: string; mimeType?: string }
  | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };

export type PiDesktopMessage = {
  role: string;
  content: PiDesktopMessageBlock[];
  timestamp?: number;
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: unknown;
};

export type PiChatEvent =
  | { type: 'run.started' }
  | { type: 'run.ended'; willRetry?: boolean }
  | { type: 'message.started'; role: string }
  | { type: 'assistant.partial'; message: PiDesktopMessage }
  | { type: 'message.ended'; message: PiDesktopMessage }
  | { type: 'tool.execution.started'; toolCallId: string; toolName: string; args?: unknown }
  | { type: 'tool.execution.updated'; toolCallId: string; toolName: string; partialResult?: unknown }
  | { type: 'tool.execution.completed'; toolCallId: string; toolName: string; result?: unknown; isError: boolean }
  | { type: 'queue.updated'; steering: string[]; followUp: string[] }
  | { type: 'compaction.started'; reason: CompactionReason }
  | { type: 'compaction.ended'; reason: CompactionReason; aborted?: boolean; willRetry?: boolean; message?: string; result?: PiCompactionResult }
  | { type: 'retry.started'; attempt?: number; maxAttempts?: number; delayMs?: number; message?: string }
  | { type: 'retry.ended'; success?: boolean }
  | { type: 'bash.execution.update'; delta: string };

export type PiRuntimeEventEnvelope = {
  sessionId: string;
  generation: number;
  at: number;
  event: PiChatEvent;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeMessage(value: unknown): PiDesktopMessage | null {
  const source = record(value);
  if (!source || typeof source.role !== 'string') return null;
  const blocks: PiDesktopMessageBlock[] = [];
  const content = source.content;
  if (typeof content === 'string') blocks.push({ type: 'text', text: content });
  if (Array.isArray(content)) {
    for (const raw of content) {
      const block = record(raw);
      if (!block || typeof block.type !== 'string') continue;
      if (block.type === 'text' && typeof block.text === 'string') blocks.push({ type: 'text', text: block.text });
      else if (block.type === 'thinking' && typeof block.thinking === 'string') blocks.push({ type: 'thinking', thinking: block.thinking });
      else if (block.type === 'image') blocks.push({ type: 'image', data: typeof block.data === 'string' ? block.data : undefined, mimeType: typeof block.mimeType === 'string' ? block.mimeType : undefined });
      else if (block.type === 'toolCall' && typeof block.id === 'string' && typeof block.name === 'string') {
        blocks.push({ type: 'toolCall', id: block.id, name: block.name, arguments: record(block.arguments) ?? {} });
      }
    }
  }
  return {
    role: source.role,
    content: blocks,
    timestamp: typeof source.timestamp === 'number' ? source.timestamp : undefined,
    provider: typeof source.provider === 'string' ? source.provider : undefined,
    model: typeof source.model === 'string' ? source.model : undefined,
    stopReason: typeof source.stopReason === 'string' ? source.stopReason : undefined,
    errorMessage: typeof source.errorMessage === 'string' ? source.errorMessage : undefined,
    usage: source.usage,
  };
}

export function mapPiSessionEvent(value: unknown): PiChatEvent | null {
  const event = record(value);
  if (!event || typeof event.type !== 'string') return null;
  switch (event.type) {
    case 'agent_start': return { type: 'run.started' };
    case 'agent_end': return { type: 'run.ended', willRetry: typeof event.willRetry === 'boolean' ? event.willRetry : undefined };
    case 'message_start': {
      const message = record(event.message);
      return typeof message?.role === 'string' ? { type: 'message.started', role: message.role } : null;
    }
    case 'message_update': {
      const update = record(event.assistantMessageEvent);
      const partial = normalizeMessage(update?.partial);
      return partial ? { type: 'assistant.partial', message: partial } : null;
    }
    case 'message_end': {
      const message = normalizeMessage(event.message);
      return message ? { type: 'message.ended', message } : null;
    }
    case 'tool_execution_start':
      return typeof event.toolCallId === 'string' && typeof event.toolName === 'string'
        ? { type: 'tool.execution.started', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args }
        : null;
    case 'tool_execution_update':
      return typeof event.toolCallId === 'string' && typeof event.toolName === 'string'
        ? { type: 'tool.execution.updated', toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult }
        : null;
    case 'tool_execution_end':
      return typeof event.toolCallId === 'string' && typeof event.toolName === 'string'
        ? { type: 'tool.execution.completed', toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError === true }
        : null;
    case 'queue_update':
      return { type: 'queue.updated', steering: Array.isArray(event.steering) ? event.steering.filter((x): x is string => typeof x === 'string') : [], followUp: Array.isArray(event.followUp) ? event.followUp.filter((x): x is string => typeof x === 'string') : [] };
    case 'compaction_start':
      return event.reason === 'manual' || event.reason === 'threshold' || event.reason === 'overflow' ? { type: 'compaction.started', reason: event.reason } : null;
    case 'compaction_end': {
      const result = record(event.result);
      const usage = record(result?.usage);
      return {
        type: 'compaction.ended',
        reason: event.reason === 'manual' || event.reason === 'threshold' || event.reason === 'overflow' ? event.reason : 'manual',
        aborted: typeof event.aborted === 'boolean' ? event.aborted : undefined,
        willRetry: typeof event.willRetry === 'boolean' ? event.willRetry : undefined,
        message: typeof event.errorMessage === 'string' ? event.errorMessage : undefined,
        ...(result && typeof result.tokensBefore === 'number' ? { result: { tokensBefore: result.tokensBefore, estimatedTokensAfter: typeof result.estimatedTokensAfter === 'number' ? result.estimatedTokensAfter : undefined, usage: usage && typeof usage.input === 'number' ? { input: usage.input, output: Number(usage.output ?? 0), cacheRead: Number(usage.cacheRead ?? 0), cacheWrite: Number(usage.cacheWrite ?? 0), cost: Number(record(usage.cost)?.total ?? 0) } : undefined } } : {}),
      };
    }
    case 'auto_retry_start': return { type: 'retry.started', attempt: typeof event.attempt === 'number' ? event.attempt : undefined, maxAttempts: typeof event.maxAttempts === 'number' ? event.maxAttempts : undefined, delayMs: typeof event.delayMs === 'number' ? event.delayMs : undefined, message: typeof event.errorMessage === 'string' ? event.errorMessage : undefined };
    case 'auto_retry_end': return { type: 'retry.ended', success: typeof event.success === 'boolean' ? event.success : undefined };
    case 'bash_execution_update': return typeof event.delta === 'string' ? { type: 'bash.execution.update', delta: event.delta } : null;
    default: return null;
  }
}
