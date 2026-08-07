import { describe, expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { mapPiSessionEvent } from '@shared/pi-event-map';
import recorded from '../fixtures/pi-events/text-and-toolcall.json';

const events = recorded as unknown as AgentSessionEvent[];

describe('pi-event-map（录制 fixture 回放，pi 0.83.0）', () => {
  it('关键事件一个不漏地映射', () => {
    const mapped = events.map(mapPiSessionEvent);
    const types = mapped.filter(Boolean).map((e) => e!.type);

    expect(types).toContain('run.started');
    expect(types).toContain('run.ended');
    expect(types).toContain('message.started');
    expect(types).toContain('assistant.partial');
    expect(types).toContain('message.ended');
    expect(types).toContain('tool.execution.started');
    expect(types).toContain('tool.execution.completed');
  });

  it('tool.execution 事件携带 toolCallId/toolName/args/result/isError', () => {
    const started = events
      .map(mapPiSessionEvent)
      .find((e) => e?.type === 'tool.execution.started');
    expect(started).toMatchObject({ toolCallId: 'call_mock_1', toolName: 'ls', args: { path: '.' } });

    const completed = events
      .map(mapPiSessionEvent)
      .find((e) => e?.type === 'tool.execution.completed');
    expect(completed).toMatchObject({ toolCallId: 'call_mock_1', toolName: 'ls', isError: false });
  });

  it('assistant.partial 携带完整 partial 消息（替换式渲染）', () => {
    const partials = events
      .map(mapPiSessionEvent)
      .filter((e) => e?.type === 'assistant.partial');
    expect(partials.length).toBeGreaterThan(0);
    for (const p of partials) {
      expect(p).toHaveProperty('message');
    }
  });

  it('turn_start/turn_end/agent_settled 等不映射（返回 null）', () => {
    for (const ev of events) {
      if (['turn_start', 'turn_end', 'agent_settled'].includes(ev.type)) {
        expect(mapPiSessionEvent(ev)).toBeNull();
      }
    }
  });

  it('auto_retry_start 透传 attempt/maxAttempts/delayMs/errorMessage', () => {
    const mapped = mapPiSessionEvent({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 8000,
      errorMessage: '429 rate limited',
    } as AgentSessionEvent);
    expect(mapped).toEqual({
      type: 'retry.started',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 8000,
      message: '429 rate limited',
    });
  });

  it('auto_retry_end 透传 success', () => {
    const mapped = mapPiSessionEvent({
      type: 'auto_retry_end',
      success: true,
      attempt: 1,
    } as AgentSessionEvent);
    expect(mapped).toEqual({ type: 'retry.ended', success: true });
  });

  it('compaction_start/end 透传 reason/willRetry/errorMessage', () => {
    const started = mapPiSessionEvent({
      type: 'compaction_start',
      reason: 'overflow',
    } as AgentSessionEvent);
    expect(started).toEqual({ type: 'compaction.started', reason: 'overflow' });

    const ended = mapPiSessionEvent({
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed: boom',
    } as AgentSessionEvent);
    expect(ended).toEqual({
      type: 'compaction.ended',
      reason: 'manual',
      aborted: false,
      willRetry: false,
      message: 'Compaction failed: boom',
    });
  });
});
