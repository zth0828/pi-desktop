import { describe, expect, it } from 'vitest';
import { collectSessionCommands } from '../../src/lib/session-commands';
import type { ChatMessage, ToolExecution } from '../../src/lib/chat-types';

describe('collectSessionCommands', () => {
  it('当所有数据源为空时返回空数组', () => {
    expect(collectSessionCommands(undefined, undefined, null)).toEqual([]);
    expect(collectSessionCommands({}, [], null)).toEqual([]);
  });

  it('正确聚合正在运行的用户命令 (bashDraft) 并置顶', () => {
    const bashDraft = {
      command: 'npm run dev',
      output: 'VITE ready in 200ms',
      excludeFromContext: true,
    };
    const items = collectSessionCommands({}, [], bashDraft);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'user-draft-running',
      source: 'user',
      command: 'npm run dev',
      status: 'running',
      output: 'VITE ready in 200ms',
      excludeFromContext: true,
    });
  });

  it('正确聚合历史用户命令 (role === bashExecution)', () => {
    const historyMessages: ChatMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        raw: {},
      },
      {
        role: 'bashExecution',
        content: [],
        timestamp: 1000,
        entryId: 'entry-1',
        raw: {
          command: 'echo "hello"',
          output: 'hello\n',
          exitCode: 0,
        },
      },
      {
        role: 'bashExecution',
        content: [],
        timestamp: 2000,
        raw: {
          command: 'cat nonexistent.txt',
          output: 'cat: nonexistent.txt: No such file or directory\n',
          exitCode: 1,
        },
      },
    ];

    const items = collectSessionCommands({}, historyMessages, null);
    expect(items).toHaveLength(2);
    // 降序排序，最新（timestamp 2000）在前
    expect(items[0]).toMatchObject({
      id: 'user-cmd-2-2000',
      source: 'user',
      command: 'cat nonexistent.txt',
      status: 'error',
      exitCode: 1,
    });
    expect(items[1]).toMatchObject({
      id: 'user-cmd-entry-1',
      source: 'user',
      command: 'echo "hello"',
      status: 'success',
      exitCode: 0,
    });
  });

  it('正确聚合 Agent 调用的 bash 工具', () => {
    const toolExecutions: Record<string, ToolExecution> = {
      'call-1': {
        toolCallId: 'call-1',
        toolName: 'read',
        status: 'success',
        args: { path: 'package.json' },
      },
      'call-2': {
        toolCallId: 'call-2',
        toolName: 'bash',
        args: { command: 'pnpm test' },
        status: 'success',
        startedAt: 1000,
        endedAt: 2500,
        result: {
          content: [{ type: 'text', text: 'Tests passed' }],
        },
      },
      'call-3': {
        toolCallId: 'call-3',
        toolName: 'bash',
        args: { command: 'pnpm build' },
        status: 'error',
        startedAt: 3000,
        endedAt: 3500,
        result: {
          content: [{ type: 'text', text: 'Error: build failed\nCommand exited with code 2' }],
        },
      },
    };

    const items = collectSessionCommands(toolExecutions, [], null);
    expect(items).toHaveLength(2);
    // call-3 startedAt 3000 > call-2 startedAt 1000
    expect(items[0]).toMatchObject({
      id: 'agent-tool-call-3',
      source: 'agent',
      command: 'pnpm build',
      status: 'error',
      exitCode: 2,
      duration: '0.5s',
      chatAnchorId: 'tool-call-call-3',
    });
    expect(items[1]).toMatchObject({
      id: 'agent-tool-call-2',
      source: 'agent',
      command: 'pnpm test',
      status: 'success',
      exitCode: 0,
      duration: '1.5s',
      chatAnchorId: 'tool-call-call-2',
    });
  });

  it('混合聚合与排序：运行中优先，其余按时间戳降序', () => {
    const bashDraft = {
      command: 'long-running-user-cmd',
      output: 'working...',
      excludeFromContext: false,
    };
    const toolExecutions: Record<string, ToolExecution> = {
      'call-1': {
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'first-agent-cmd' },
        status: 'success',
        startedAt: 100,
        endedAt: 200,
      },
    };
    const historyMessages: ChatMessage[] = [
      {
        role: 'bashExecution',
        content: [],
        timestamp: 500,
        raw: { command: 'past-user-cmd', exitCode: 0 },
      },
    ];

    const items = collectSessionCommands(toolExecutions, historyMessages, bashDraft);
    expect(items).toHaveLength(3);
    expect(items[0].command).toBe('long-running-user-cmd'); // 运行中置顶
    expect(items[1].command).toBe('past-user-cmd');          // timestamp 500
    expect(items[2].command).toBe('first-agent-cmd');        // timestamp 100
  });
});
