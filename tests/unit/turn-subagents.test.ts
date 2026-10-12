import { describe, expect, it } from 'vitest';
import { extractSubagentSubTasks, isSubagentTool } from '../../src/lib/subagent-tool';
import { groupLogicalTurns } from '../../src/lib/turn-changes';

describe('TurnSubagents detection', () => {
  it('correctly associates subagent tool calls in logical turn', () => {
    const messages: any[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'USE_TOOL_SUBAGENT' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'PROCESS: running subagent' },
          {
            type: 'toolCall',
            id: 'call_mock_1',
            name: 'subagent',
            arguments: { agent: 'researcher', task: 'indexing codebase' },
          },
        ],
      },
      {
        role: 'toolResult',
        raw: {
          toolCallId: 'call_mock_1',
          content: 'Subagent indexing completed',
        },
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'FINAL:Subagent indexing completed' }],
      },
    ];

    const turns = groupLogicalTurns(messages);
    expect(turns.length).toBe(1);
    expect(turns[0].toolCallIds).toEqual(['call_mock_1']);

    const toolExecutions: Record<string, any> = {
      call_mock_1: {
        toolCallId: 'call_mock_1',
        toolName: 'subagent',
        args: { agent: 'researcher', task: 'indexing codebase' },
        status: 'success',
        result: { content: [{ type: 'text', text: 'Subagent indexing completed' }] },
      },
    };

    const hasSubagents = turns[0].toolCallIds.some((id) => {
      const name = toolExecutions[id]?.toolName;
      return name && isSubagentTool(name);
    });

    expect(hasSubagents).toBe(true);

    const subTasks = extractSubagentSubTasks(toolExecutions.call_mock_1);
    expect(subTasks.length).toBe(1);
    expect(subTasks[0].agent).toBe('researcher');
    expect(subTasks[0].task).toBe('indexing codebase');
  });
});
