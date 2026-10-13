import { describe, expect, it } from 'vitest';
import {
  extractSubagentProgress,
  extractSubagentSubTasks,
  extractSubagentText,
  formatToolArgs,
  isSubagentTool,
  parseActionTraces,
} from '../../src/lib/subagent-tool';
import type { ToolExecution } from '../../src/lib/chat-types';

describe('subagent-tool helper', () => {
  it('isSubagentTool 能准确识别各种 subagent 与 task 工具名称', () => {
    expect(isSubagentTool('subagent')).toBe(true);
    expect(isSubagentTool('run_subagent')).toBe(true);
    expect(isSubagentTool('subagent_run')).toBe(true);
    expect(isSubagentTool('task')).toBe(true);
    expect(isSubagentTool('task_runner')).toBe(true);
    expect(isSubagentTool('agent_worker')).toBe(true);
    expect(isSubagentTool('delegate')).toBe(true);
    expect(isSubagentTool('worker')).toBe(true);

    expect(isSubagentTool('read')).toBe(false);
    expect(isSubagentTool('bash')).toBe(false);
    expect(isSubagentTool('write')).toBe(false);
    expect(isSubagentTool('')).toBe(false);
    expect(isSubagentTool(undefined)).toBe(false);
  });

  it('formatToolArgs 正确格式化对象与基础类型', () => {
    expect(formatToolArgs({ agent: 'scout' })).toBe('{\n  "agent": "scout"\n}');
    expect(formatToolArgs('plain text')).toBe('plain text');
    expect(formatToolArgs(undefined)).toBe('');
    expect(formatToolArgs(null)).toBe('');
  });

  it('extractSubagentText 能从各种包装中提取纯文本', () => {
    expect(extractSubagentText('direct string')).toBe('direct string');
    expect(extractSubagentText({ output: 'output text' })).toBe('output text');
    expect(extractSubagentText({ text: 'text field' })).toBe('text field');
    expect(extractSubagentText({ content: [{ type: 'text', text: 'content text' }] })).toBe('content text');
  });

  it('parseActionTraces 支持 tool_use 与 pi 原生 toolCall 轨迹提取', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'start' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'read',
            input: { path: 'server/api/v1/user.go' },
          },
          {
            type: 'toolCall',
            id: 'call-2',
            name: 'grep',
            arguments: { query: 'SELECT', path: 'server/' },
          },
        ],
      },
    ];

    const traces = parseActionTraces(messages);
    expect(traces).toHaveLength(2);
    expect(traces[0].toolName).toBe('read');
    expect(traces[0].id).toBe('call-1');
    expect(traces[1].toolName).toBe('grep');
    expect(traces[1].id).toBe('call-2');
  });

  it('parseActionTraces 支持字符串格式的 toolResult 内容提取', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-read',
            name: 'read',
            input: { path: 'package.json' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-read',
        content: '{"name": "test-pkg"}',
      },
    ];

    const traces = parseActionTraces(messages);
    expect(traces).toHaveLength(1);
    expect(traces[0].output).toBe('{"name": "test-pkg"}');
  });

  it('extractSubagentSubTasks 能处理字符串 content 的 assistant 答复', () => {
    const execution: ToolExecution = {
      toolCallId: 'call-str',
      toolName: 'subagent',
      status: 'success',
      args: { task: '单任务分析' },
      result: {
        details: {
          results: [
            {
              agent: 'worker',
              task: '单任务分析',
              exitCode: 0,
              messages: [
                { role: 'assistant', content: '纯文本完成说明' },
              ],
            },
          ],
        },
      },
    };

    const subtasks = extractSubagentSubTasks(execution);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].output).toBe('纯文本完成说明');
  });

  it('extractSubagentSubTasks 能从 messages 末尾提取最终文本，并正确标记退出码失败状态', () => {
    const execution: ToolExecution = {
      toolCallId: 'call-100',
      toolName: 'subagent',
      status: 'success',
      args: {
        tasks: [
          { agent: 'scout', task: '分析后端接口' },
          { agent: 'Explore', task: '无效 agent' },
        ],
      },
      result: {
        content: [{ type: 'text', text: 'Done' }],
        details: {
          results: [
            {
              agent: 'scout',
              task: '分析后端接口',
              exitCode: 0,
              messages: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'toolCall',
                      id: 'call-sub-1',
                      name: 'read',
                      arguments: { path: 'server/api/v1/user.go' },
                    },
                  ],
                },
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: '# 排查分析完成\n发现 2 处潜在漏洞。',
                    },
                  ],
                },
              ],
              usage: { input: 100, output: 50, total: 150 },
            },
            {
              agent: 'Explore',
              task: '无效 agent',
              exitCode: 1,
              stderr: 'Unknown agent: "Explore".',
              messages: [],
            },
          ],
        },
      },
    };

    const subtasks = extractSubagentSubTasks(execution);
    expect(subtasks).toHaveLength(2);

    expect(subtasks[0].agent).toBe('scout');
    expect(subtasks[0].status).toBe('success');
    expect(subtasks[0].output).toBe('# 排查分析完成\n发现 2 处潜在漏洞。');
    expect(subtasks[0].actions).toHaveLength(1);
    expect(subtasks[0].actions[0].toolName).toBe('read');
    expect(subtasks[0].messages).toHaveLength(2);

    expect(subtasks[1].agent).toBe('Explore');
    expect(subtasks[1].status).toBe('error');
    expect(subtasks[1].stderr).toBe('Unknown agent: "Explore".');
  });

  it('extractSubagentSubTasks 在任务执行中（running）时保留状态', () => {
    const execution: ToolExecution = {
      toolCallId: 'call-200',
      toolName: 'subagent',
      status: 'running',
      args: {
        tasks: [{ agent: 'worker', task: '正在跑测试' }],
      },
      partialResult: 'running stdout...',
    };

    const subtasks = extractSubagentSubTasks(execution);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].status).toBe('running');
    expect(subtasks[0].agent).toBe('worker');
    expect(subtasks[0].task).toBe('正在跑测试');
  });
});
