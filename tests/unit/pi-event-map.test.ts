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
});
