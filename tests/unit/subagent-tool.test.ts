import { describe, expect, it } from 'vitest';
import {
  extractSubagentProgress,
  extractSubagentText,
  formatToolArgs,
  isSubagentTool,
} from '../../src/lib/subagent-tool';
import type { ToolExecution } from '../../src/lib/chat-types';

describe('isSubagentTool', () => {
  it('识别标准与常见子任务工具名', () => {
    expect(isSubagentTool('subagent')).toBe(true);
    expect(isSubagentTool('subagent_run')).toBe(true);
    expect(isSubagentTool('run_subagent')).toBe(true);
    expect(isSubagentTool('task')).toBe(true);
    expect(isSubagentTool('task_runner')).toBe(true);
    expect(isSubagentTool('run_task')).toBe(true);
    expect(isSubagentTool('delegate')).toBe(true);
    expect(isSubagentTool('delegate_task')).toBe(true);
    expect(isSubagentTool('agent_worker')).toBe(true);
    expect(isSubagentTool('research_agent')).toBe(true);
    expect(isSubagentTool('worker')).toBe(true);
  });

  it('排除非子任务工具', () => {
    expect(isSubagentTool('bash')).toBe(false);
    expect(isSubagentTool('edit')).toBe(false);
    expect(isSubagentTool('write')).toBe(false);
    expect(isSubagentTool('read')).toBe(false);
    expect(isSubagentTool('grep')).toBe(false);
    expect(isSubagentTool('find')).toBe(false);
    expect(isSubagentTool('ls')).toBe(false);
    expect(isSubagentTool('mcp')).toBe(false);
    expect(isSubagentTool('read_file')).toBe(false);
    expect(isSubagentTool('')).toBe(false);
    expect(isSubagentTool(undefined)).toBe(false);
  });
});

describe('formatToolArgs', () => {
  it('格式化对象为美化 JSON 字符串', () => {
    const formatted = formatToolArgs({ agent: 'coder', task: 'refactor code' });
    expect(formatted).toContain('"agent": "coder"');
    expect(formatted).toContain('"task": "refactor code"');
  });

  it('处理空/字符串/异常输入', () => {
    expect(formatToolArgs(undefined)).toBe('');
    expect(formatToolArgs(null)).toBe('');
    expect(formatToolArgs('raw text')).toBe('raw text');
  });
});

describe('extractSubagentText', () => {
  it('提取标准 pi content 结构文本', () => {
    const result = {
      content: [
        { type: 'text', text: 'Step 1 done' },
        { type: 'text', text: 'Step 2 done' },
      ],
    };
    expect(extractSubagentText(result)).toBe('Step 1 done\nStep 2 done');
  });

  it('提取自由文本或兜底字段', () => {
    expect(extractSubagentText('Raw output text')).toBe('Raw output text');
    expect(extractSubagentText({ text: 'Progress 80%' })).toBe('Progress 80%');
    expect(extractSubagentText({ message: 'Task completed' })).toBe('Task completed');
    expect(extractSubagentText({ output: 'Build successful' })).toBe('Build successful');
    expect(extractSubagentText({ summary: 'Found 3 bugs' })).toBe('Found 3 bugs');
    expect(extractSubagentText(null)).toBe('');
  });
});

describe('extractSubagentProgress', () => {
  it('运行中优先从 partialResult 提取流式摘要与进度', () => {
    const execution: ToolExecution = {
      toolCallId: 'call_sub_1',
      toolName: 'subagent',
      args: { agent: 'researcher', task: 'analyze dependencies' },
      status: 'running',
      startedAt: 1000,
      partialResult: { content: [{ type: 'text', text: 'Indexing 40%...' }] },
    };
    const info = extractSubagentProgress(execution);
    expect(info.summary).toBe('researcher');
    expect(info.agentName).toBe('researcher');
    expect(info.outputText).toBe('Indexing 40%...');
  });

  it('已结束从 result 提取最终结果', () => {
    const execution: ToolExecution = {
      toolCallId: 'call_task_1',
      toolName: 'task',
      args: { task: 'run unit tests', description: 'testing suite' },
      status: 'success',
      startedAt: 1000,
      endedAt: 2000,
      result: { content: [{ type: 'text', text: 'All 15 tests passed.' }] },
    };
    const info = extractSubagentProgress(execution);
    expect(info.summary).toBe('run unit tests');
    expect(info.outputText).toBe('All 15 tests passed.');
  });
});
