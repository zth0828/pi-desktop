import { describe, expect, it } from 'vitest';
import { collectTurnChanges, groupLogicalTurns, turnTimeRange } from '../../src/lib/turn-changes';
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

function msg(role: string, toolCallIds: string[] = []): ChatMessage {
  return {
    role,
    content: toolCallIds.map((id) => ({ type: 'toolCall', id, name: 'edit' })),
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
      { toolCallIds: ['call1', 'call2'], endIndex: 3 },
      { toolCallIds: [], endIndex: 5 },
    ]);
  });

  it('首条 user 之前的消息不属于任何轮', () => {
    const messages = [msg('assistant', ['call0']), msg('user'), msg('assistant', ['call1'])];
    expect(groupLogicalTurns(messages)).toEqual([{ toolCallIds: ['call1'], endIndex: 2 }]);
  });

  it('user 消息自成一轮（尚无回复时 endIndex 指向自己）', () => {
    expect(groupLogicalTurns([msg('user')])).toEqual([{ toolCallIds: [], endIndex: 0 }]);
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
