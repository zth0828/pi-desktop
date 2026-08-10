import { describe, expect, it } from 'vitest';
import { rebuildToolExecutionsFromMessages, type ChatMessage } from '../../src/lib/chat-types';

function assistant(blocks: ChatMessage['content']): ChatMessage {
  return { role: 'assistant', content: blocks, timestamp: 1_700_000_000_000, raw: {} };
}

function toolResult(toolCallId: string, isError = false): ChatMessage {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text: 'ok' }],
    timestamp: 1_700_000_001_000,
    raw: { toolCallId, isError, content: [{ type: 'text', text: 'ok' }], details: { diff: '+1 x' } },
  };
}

describe('rebuildToolExecutionsFromMessages', () => {
  it('toolCall 与 toolResult 配对出成功执行（含结果 details）', () => {
    const executions = rebuildToolExecutionsFromMessages([
      assistant([{ type: 'toolCall', id: 'c1', name: 'edit', arguments: { path: 'a.ts' } }]),
      toolResult('c1'),
    ]);
    expect(executions.c1.status).toBe('success');
    expect(executions.c1.toolName).toBe('edit');
    expect(executions.c1.args).toEqual({ path: 'a.ts' });
    expect((executions.c1.result as { details: unknown }).details).toEqual({ diff: '+1 x' });
    expect(executions.c1.startedAt).toBe(1_700_000_000_000);
    expect(executions.c1.endedAt).toBe(1_700_000_001_000);
  });

  it('isError 的 toolResult 映射为 error', () => {
    const executions = rebuildToolExecutionsFromMessages([
      assistant([{ type: 'toolCall', id: 'c1', name: 'bash' }]),
      toolResult('c1', true),
    ]);
    expect(executions.c1.status).toBe('error');
    expect(executions.c1.interrupted).toBeUndefined();
  });

  it('没有 toolResult 的历史调用标记为中断（不永远停在执行中）', () => {
    const executions = rebuildToolExecutionsFromMessages([
      assistant([{ type: 'toolCall', id: 'c1', name: 'bash' }]),
    ]);
    expect(executions.c1.status).toBe('error');
    expect(executions.c1.interrupted).toBe(true);
  });
});
