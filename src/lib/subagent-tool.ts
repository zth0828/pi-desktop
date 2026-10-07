import type { ToolExecution } from './chat-types';
import { extractResultText, toolSummary } from './tool-display';

/**
 * 判断某个工具是否属于子智能体 / 子任务类型工具。
 * 兼容常见子任务工具命名：
 * - subagent, subagent_run, subagent_exec, run_subagent
 * - task, task_runner, run_task, spawn_task
 * - agent, agent_worker, delegate, delegate_task
 * - worker
 */
export function isSubagentTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const name = toolName.trim().toLowerCase();
  if (name === 'subagent' || name === 'task' || name === 'agent' || name === 'delegate' || name === 'worker') {
    return true;
  }
  return (
    name.includes('subagent') ||
    name.includes('delegate') ||
    /^(agent|task|worker)[_-]/i.test(name) ||
    /[_-](agent|task|worker)$/i.test(name)
  );
}

/**
 * 格式化参数对象，用于卡片与面板中的参数展示。
 */
export function formatToolArgs(args: unknown): string {
  if (args === undefined || args === null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * 从结果对象（含 partialResult）提取文本。
 * 优先取标准 pi content 结构，兼容兜底文本字段与原始字符串。
 */
export function extractSubagentText(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  const fromStandard = extractResultText(result);
  if (fromStandard) return fromStandard;

  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (typeof r.text === 'string' && r.text.trim()) return r.text.trim();
    if (typeof r.message === 'string' && r.message.trim()) return r.message.trim();
    if (typeof r.summary === 'string' && r.summary.trim()) return r.summary.trim();
    if (typeof r.output === 'string' && r.output.trim()) return r.output.trim();
    if (typeof r.result === 'string' && r.result.trim()) return r.result.trim();
    if (typeof r.content === 'string' && r.content.trim()) return r.content.trim();
  }
  return '';
}

export interface SubagentProgressInfo {
  summary: string;
  agentName?: string;
  outputText: string;
}

/**
 * 提取子任务的展示摘要与输出文本。
 */
export function extractSubagentProgress(execution: ToolExecution): SubagentProgressInfo {
  const summary = toolSummary(execution.toolName, execution.args) ?? execution.toolName;
  let agentName: string | undefined;

  if (execution.args && typeof execution.args === 'object') {
    const a = execution.args as Record<string, unknown>;
    if (typeof a.agent === 'string' && a.agent.trim()) {
      agentName = a.agent.trim();
    } else if (typeof a.name === 'string' && a.name.trim()) {
      agentName = a.name.trim();
    }
  }

  const outputSource = execution.status === 'running' && execution.partialResult !== undefined
    ? execution.partialResult
    : execution.result;

  const outputText = extractSubagentText(outputSource);

  return {
    summary,
    agentName,
    outputText,
  };
}
