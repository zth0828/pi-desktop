import { describe, expect, it } from 'vitest';
import { collectTurnChanges, groupLogicalTurns, groupTurnStages, turnDurationMs, turnFinalResponseIndex, turnTimeRange } from '../../src/lib/turn-changes';
import { formatWorkDuration } from '../../src/lib/tool-display';
import type { ChatMessage, ToolExecution } from '../../src/lib/chat-types';

function exec(partial: Partial<ToolExecution> & { toolCallId: string }): ToolExecution {
  return { toolName: 'edit', status: 'success', ...partial };
}

describe('collectTurnChanges', () => {
  it('edit 从 details.diff 统计 +/-', () => {
    const executions: Record<string, ToolExecution> = {
      call1: exec({
        toolCallId: 'call1',
        args: { path: 'a.ts' },
        result: { content: [], details: { diff: '+10 new line\n-10 old line\n 10 context' } },
      }),
    };
    const changes = collectTurnChanges(executions, ['call1']);
    expect(changes.files).toEqual([{ path: 'a.ts', added: 1, deleted: 1 }]);
    expect(changes.added).toBe(1);
    expect(changes.deleted).toBe(1);
  });

  it('write 新建文件按 args.content 行数计 +N -0（末尾换行不多算）', () => {
    const executions: Record<string, ToolExecution> = {
      call1: exec({
        toolCallId: 'call1',
        toolName: 'write',
        args: { path: 'b.txt', content: 'hello\nworld\n' },
      }),
    };
    const changes = collectTurnChanges(executions, ['call1']);
    expect(changes.files).toEqual([{ path: 'b.txt', added: 2, deleted: 0 }]);
  });

  it('write 空内容与无末尾换行的行数口径', () => {
    const executions: Record<string, ToolExecution> = {
      call1: exec({ toolCallId: 'call1', toolName: 'write', args: { path: 'empty.txt', content: '' } }),
      call2: exec({ toolCallId: 'call2', toolName: 'write', args: { path: 'one.txt', content: 'no-newline' } }),
    };
    const changes = collectTurnChanges(executions, ['call1', 'call2']);
    expect(changes.files).toEqual([
      { path: 'empty.txt', added: 0, deleted: 0 },
      { path: 'one.txt', added: 1, deleted: 0 },
    ]);
  });

  it('同一文件多次改动合并累计，按首次出现排序', () => {
    const executions: Record<string, ToolExecution> = {
      call1: exec({
        toolCallId: 'call1',
        args: { path: 'a.ts' },
        result: { content: [], details: { diff: '+1 x' } },
      }),
      call2: exec({
        toolCallId: 'call2',
        toolName: 'write',
        args: { path: 'b.ts', content: 'line\n' },
      }),
      call3: exec({
        toolCallId: 'call3',
        args: { path: 'a.ts' },
        result: { content: [], details: { diff: '+2 y\n-2 z' } },
      }),
    };
    const changes = collectTurnChanges(executions, ['call1', 'call2', 'call3']);
    expect(changes.files).toEqual([
      { path: 'a.ts', added: 2, deleted: 1 },
      { path: 'b.ts', added: 1, deleted: 0 },
    ]);
    expect(changes.added).toBe(3);
    expect(changes.deleted).toBe(1);
  });

  it('跳过失败/中断/无 diff 的执行与非 edit/write 工具', () => {
    const executions: Record<string, ToolExecution> = {
      call1: exec({ toolCallId: 'call1', status: 'error', args: { path: 'a.ts' } }),
      call2: exec({ toolCallId: 'call2', status: 'running', args: { path: 'a.ts' } }),
      call3: exec({ toolCallId: 'call3', toolName: 'bash', args: { command: 'ls' } }),
      call4: exec({ toolCallId: 'call4', args: { path: 'a.ts' }, result: { content: [] } }),
    };
    const changes = collectTurnChanges(executions, ['call1', 'call2', 'call3', 'call4', 'missing']);
    expect(changes.files).toEqual([]);
  });
});

describe('formatWorkDuration', () => {
  it('秒级 / 分级 / 时级', () => {
    expect(formatWorkDuration(0, 28_000)).toBe('28s');
    expect(formatWorkDuration(0, 88_000)).toBe('1m 28s');
    expect(formatWorkDuration(0, 3_600_000 + 120_000)).toBe('1h 2m');
    expect(formatWorkDuration(0, 400)).toBe('0s');
  });

  it('时间戳缺失或异常返回 null', () => {
    expect(formatWorkDuration(undefined, 1000)).toBeNull();
    expect(formatWorkDuration(1000)).toBeNull();
    expect(formatWorkDuration(2000, 1000)).toBeNull();
  });
});

function msg(role: string, toolCallIds: string[] = [], timestamp?: number): ChatMessage {
  return {
    role,
    content: toolCallIds.map((id) => ({ type: 'toolCall', id, name: 'edit' })),
    timestamp,
    raw: null,
  };
}

describe('groupLogicalTurns', () => {
  it('user 消息开启新一轮，后续消息归入该轮（含 toolResult 占位）', () => {
    const messages = [
      msg('user'),
      msg('assistant', ['call1']),
      msg('toolResult'),
      msg('assistant', ['call2']),
      msg('user'),
      msg('assistant'),
    ];
    const turns = groupLogicalTurns(messages);
    expect(turns).toEqual([
      { startIndex: 0, toolCallIds: ['call1', 'call2'], endIndex: 3 },
      { startIndex: 4, toolCallIds: [], endIndex: 5 },
    ]);
  });

  it('首条 user 之前的消息不属于任何轮', () => {
    const messages = [msg('assistant', ['call0']), msg('user'), msg('assistant', ['call1'])];
    expect(groupLogicalTurns(messages)).toEqual([{ startIndex: 1, toolCallIds: ['call1'], endIndex: 2 }]);
  });

  it('user 消息自成一轮（尚无回复时 endIndex 指向自己）', () => {
    expect(groupLogicalTurns([msg('user')])).toEqual([{ startIndex: 0, toolCallIds: [], endIndex: 0 }]);
  });
});

describe('groupTurnStages', () => {
  it('连续思考与后续工具结果归为阶段，不按每个 thinking block 拆分', () => {
    const messages: ChatMessage[] = [
      msg('user'),
      { ...msg('assistant'), content: [{ type: 'thinking', thinking: 'inspect' }] },
      { ...msg('assistant', ['call1']), content: [{ type: 'thinking', thinking: 'read files' }, { type: 'toolCall', id: 'call1', name: 'read' }] },
      msg('toolResult'),
      { ...msg('assistant', ['call2']), content: [{ type: 'thinking', thinking: 'apply fix' }, { type: 'toolCall', id: 'call2', name: 'edit' }] },
      msg('toolResult'),
    ];
    expect(groupTurnStages(messages, [1, 2, 3, 4, 5], '0')).toEqual([
      { key: '0:0', indices: [1, 2, 3] },
      { key: '0:1', indices: [4, 5] },
    ]);
  });
});

describe('turnFinalResponseIndex', () => {
  it('返回工具执行后不再发起工具调用的最终文本消息', () => {
    const messages = [
      msg('user'),
      { ...msg('assistant', ['call1']), content: [{ type: 'text', text: 'Checking' }, { type: 'toolCall', id: 'call1', name: 'read' }] },
      msg('toolResult'),
      { ...msg('assistant'), content: [{ type: 'text', text: 'Final answer' }] },
    ];
    const [turn] = groupLogicalTurns(messages);
    expect(turnFinalResponseIndex(messages, turn)).toBe(3);
  });

  it('中断轮没有最终文本时不聚合', () => {
    const messages = [msg('user'), msg('assistant', ['call1']), msg('toolResult')];
    const [turn] = groupLogicalTurns(messages);
    expect(turnFinalResponseIndex(messages, turn)).toBeUndefined();
  });

  it('失败回合（errorMessage）把带错误的 assistant 消息视为最终结果', () => {
    const messages = [
      msg('user'),
      { ...msg('assistant'), content: [{ type: 'thinking', thinking: 'probe' }] },
      {
        ...msg('assistant'),
        content: [],
        raw: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'OpenAI API error (503): boom' },
      },
    ];
    const [turn] = groupLogicalTurns(messages);
    expect(turnFinalResponseIndex(messages, turn)).toBe(2);
  });

  it('失败回合没有 errorMessage 时仍不聚合', () => {
    const messages = [
      msg('user'),
      { ...msg('assistant'), content: [{ type: 'thinking', thinking: 'probe' }] },
      { ...msg('assistant'), content: [], raw: { role: 'assistant', content: [], stopReason: 'stop' } },
    ];
    const [turn] = groupLogicalTurns(messages);
    expect(turnFinalResponseIndex(messages, turn)).toBeUndefined();
  });
});

describe('turnTimeRange', () => {
  it('取该轮工具执行的 min(startedAt) / max(endedAt)', () => {
    const executions: Record<string, ToolExecution> = {
      a: exec({ toolCallId: 'a', startedAt: 100, endedAt: 200 }),
      b: exec({ toolCallId: 'b', startedAt: 50, endedAt: 150 }),
      c: exec({ toolCallId: 'c', startedAt: 300 }),
    };
    expect(turnTimeRange(executions, ['a', 'b', 'c', 'missing'])).toEqual({
      startedAt: 50,
      endedAt: 200,
    });
  });

  it('无时间戳时返回空', () => {
    expect(turnTimeRange({}, ['missing'])).toEqual({ startedAt: undefined, endedAt: undefined });
  });
});

describe('turnDurationMs', () => {
  it('历史回合用消息时间戳计算耗时', () => {
    const messages = [msg('user', [], 1_000), msg('assistant', ['call1'], 2_500), msg('toolResult', [], 4_000), msg('assistant', [], 8_500)];
    const [turn] = groupLogicalTurns(messages);
    expect(turnDurationMs(messages, turn, {})).toBe(7_500);
  });

  it('实时回合优先使用精确的 run 耗时', () => {
    const messages = [msg('user', [], 1_000), msg('assistant', [], 8_500)];
    const [turn] = groupLogicalTurns(messages);
    expect(turnDurationMs(messages, turn, {}, 1_234)).toBe(1_234);
  });

  it('缺少时间信息时不伪造耗时', () => {
    const messages = [msg('user'), msg('assistant')];
    const [turn] = groupLogicalTurns(messages);
    expect(turnDurationMs(messages, turn, {})).toBeNull();
  });
});
