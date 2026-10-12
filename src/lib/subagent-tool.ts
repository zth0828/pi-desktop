import type { ToolExecution } from './chat-types';
import { extractResultText, toolSummary } from './tool-display';

/**
 * 判断某个工具是否属于子智能体 / 子任务类型工具。
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
  hasErrors?: boolean;
}

/**
 * 提取子任务的展示摘要与输出文本。
 */
export function extractSubagentProgress(execution: ToolExecution): SubagentProgressInfo {
  let summary = toolSummary(execution.toolName, execution.args) ?? execution.toolName;
  let agentName: string | undefined;
  let hasErrors = Boolean(execution.status === 'error' || execution.interrupted);

  const outputSource =
    execution.status === 'running' && execution.partialResult !== undefined
      ? execution.partialResult
      : execution.result;

  const outputText = extractSubagentText(outputSource);

  // 尝试从 args 中解析 Agent 身份
  if (execution.args && typeof execution.args === 'object') {
    const a = execution.args as Record<string, unknown>;
    if (typeof a.agent === 'string' && a.agent.trim()) {
      agentName = a.agent.trim();
    } else if (typeof a.name === 'string' && a.name.trim()) {
      agentName = a.name.trim();
    } else if (Array.isArray(a.tasks) && a.tasks.length > 0) {
      const distinctAgents = Array.from(
        new Set(a.tasks.map((t: any) => t?.agent).filter(Boolean)),
      );
      if (distinctAgents.length === 1) {
        agentName = distinctAgents[0];
        summary = `${agentName} ×${a.tasks.length}`;
      } else if (distinctAgents.length > 1) {
        summary = `${distinctAgents.join(', ')} (${a.tasks.length})`;
      }
    }
  }

  // 尝试从 details.results 提取实际状态与结果
  if (outputSource && typeof outputSource === 'object') {
    const resObj = outputSource as Record<string, unknown>;
    const details = (resObj.details ?? resObj) as Record<string, unknown>;
    if (Array.isArray(details.results) && details.results.length > 0) {
      const distinctAgents = Array.from(
        new Set(details.results.map((r: any) => r?.agent).filter(Boolean)),
      );
      if (distinctAgents.length === 1) {
        agentName = distinctAgents[0];
        summary = `${agentName} ×${details.results.length}`;
      }
      const failed = details.results.some((r: any) => (typeof r.exitCode === 'number' && r.exitCode !== 0) || r.error);
      if (failed) hasErrors = true;
    }
  }

  return {
    summary,
    agentName,
    outputText,
    hasErrors,
  };
}

/**
 * 子任务内部执行的工具调用轨迹记录。
 */
export interface SubagentActionTrace {
  id: string;
  toolName: string;
  summary: string;
  args?: unknown;
}

/**
 * 结构化的单项子任务信息。
 */
export interface SubagentSubTask {
  id: string;
  index: number;
  agent: string;
  task: string;
  status: 'running' | 'success' | 'error';
  output: string;
  actions: SubagentActionTrace[];
  messages?: unknown[];
  stderr?: string;
  exitCode?: number;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

/**
 * 从消息历史记录中解析出工具调用（toolCall / tool_use）轨迹。
 */
export function parseActionTraces(messages: unknown): SubagentActionTrace[] {
  if (!Array.isArray(messages)) return [];
  const traces: SubagentActionTrace[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as {
      role?: string;
      content?: unknown;
    };
    if (!msg || typeof msg !== 'object') continue;

    if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const item = msg.content[j] as {
          type?: string;
          id?: string;
          name?: string;
          arguments?: unknown;
          input?: unknown;
          args?: unknown;
        };
        // 兼容 pi 原生 toolCall 与标准 tool_use
        if (item && (item.type === 'toolCall' || item.type === 'tool_use') && item.name) {
          const toolName = item.name;
          const inputArgs = item.arguments ?? item.input ?? item.args;
          const summary = toolSummary(toolName, inputArgs) ?? formatToolArgs(inputArgs).slice(0, 100);
          traces.push({
            id: item.id || `trace-${i}-${j}`,
            toolName,
            summary: summary || toolName,
            args: inputArgs,
          });
        }
      }
    }
  }

  return traces;
}

/**
 * 从子 agent 结果中提取最终产出的 Markdown 报告或输出。
 */
function extractSubagentTaskOutput(res: Record<string, unknown>, fallbackText?: string): string {
  // 1. 如果有明确的 output / text 字段
  if (typeof res.output === 'string' && res.output.trim()) return res.output.trim();
  const directText = extractSubagentText(res.output ?? res.content ?? res.result);
  if (directText) return directText;

  // 2. 从 messages 中倒序查找最后一条 assistant 消息包含的 text block
  if (Array.isArray(res.messages)) {
    for (let i = res.messages.length - 1; i >= 0; i--) {
      const m = res.messages[i] as { role?: string; content?: unknown };
      if (m && m.role === 'assistant' && Array.isArray(m.content)) {
        const textParts = m.content
          .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim())
          .map((b: any) => b.text.trim());
        if (textParts.length > 0) {
          return textParts.join('\n\n');
        }
      }
    }
  }

  // 3. 从整个总输出文本中匹配属于当前 agent 块的内容
  if (fallbackText && typeof res.agent === 'string') {
    const escaped = res.agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`###\\s*\\[${escaped}\\]\\s*(?:completed|succeeded)[\\s\\S]*?(?=###\\s*\\[|$)`, 'i');
    const matched = fallbackText.match(pattern);
    if (matched && matched[0]) {
      return matched[0].replace(new RegExp(`^###\\s*\\[${escaped}\\]\\s*(?:completed|succeeded)\\s*`, 'i'), '').trim();
    }
  }

  return '';
}

/**
 * 从 ToolExecution 解析出所有拆分的子任务及其内部轨迹与独立输出。
 */
export function extractSubagentSubTasks(execution: ToolExecution): SubagentSubTask[] {
  const args = execution.args && typeof execution.args === 'object'
    ? (execution.args as Record<string, unknown>)
    : null;

  // 1. 从参数定义中提取所有子任务目标声明
  interface DeclaredTask {
    agent: string;
    task: string;
  }
  const declaredList: DeclaredTask[] = [];

  const rawTasks = args?.tasks ?? args?.subtasks ?? args?.chain;
  if (Array.isArray(rawTasks)) {
    for (const item of rawTasks) {
      if (typeof item === 'string') {
        declaredList.push({ agent: 'subagent', task: item });
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const agent = (typeof rec.agent === 'string' && rec.agent.trim())
          ? rec.agent.trim()
          : (typeof rec.name === 'string' && rec.name.trim())
            ? rec.name.trim()
            : 'subagent';
        const task = (typeof rec.task === 'string' && rec.task.trim())
          ? rec.task.trim()
          : (typeof rec.prompt === 'string' && rec.prompt.trim())
            ? rec.prompt.trim()
            : (typeof rec.instruction === 'string' && rec.instruction.trim())
              ? rec.instruction.trim()
              : '';
        declaredList.push({ agent, task });
      }
    }
  } else if (args) {
    const singleTask = (typeof args.task === 'string' && args.task.trim())
      ? args.task.trim()
      : (typeof args.prompt === 'string' && args.prompt.trim())
        ? args.prompt.trim()
        : '';
    if (singleTask) {
      const singleAgent = (typeof args.agent === 'string' && args.agent.trim())
        ? args.agent.trim()
        : 'subagent';
      declaredList.push({ agent: singleAgent, task: singleTask });
    }
  }

  // 2. 从 result / partialResult 中提取返回的执行详情
  const resultSource = execution.result ?? execution.partialResult;
  let resultsFromDetails: Array<Record<string, unknown>> = [];

  if (resultSource && typeof resultSource === 'object') {
    const resObj = resultSource as Record<string, unknown>;
    const details = (resObj.details ?? resObj) as Record<string, unknown>;
    if (Array.isArray(details.results)) {
      resultsFromDetails = details.results as Array<Record<string, unknown>>;
    }
  }

  const fallbackTotalOutput = extractSubagentText(resultSource);

  // 3. 构建聚合结果列表
  const subTasks: SubagentSubTask[] = [];

  if (resultsFromDetails.length > 0) {
    resultsFromDetails.forEach((res, index) => {
      const agent = (typeof res.agent === 'string' && res.agent.trim())
        ? res.agent.trim()
        : declaredList[index]?.agent ?? 'subagent';
      const task = (typeof res.task === 'string' && res.task.trim())
        ? res.task.trim()
        : declaredList[index]?.task ?? '';

      const output = extractSubagentTaskOutput(res, fallbackTotalOutput);
      const actions = parseActionTraces(res.messages);
      const messages = Array.isArray(res.messages) ? res.messages : undefined;
      const stderr = typeof res.stderr === 'string' && res.stderr.trim() ? res.stderr.trim() : undefined;
      const exitCode = typeof res.exitCode === 'number' ? res.exitCode : undefined;

      const usage = res.usage && typeof res.usage === 'object'
        ? (res.usage as { input?: number; output?: number; total?: number })
        : undefined;

      const isFailed = (typeof exitCode === 'number' && exitCode !== 0) ||
        Boolean(res.error) ||
        (stderr && (stderr.includes('Unknown agent') || stderr.includes('Error:')));

      const status: SubagentSubTask['status'] = execution.status === 'running'
        ? 'running'
        : isFailed || execution.status === 'error' || execution.interrupted
          ? 'error'
          : 'success';

      subTasks.push({
        id: `subtask-${execution.toolCallId}-${index}`,
        index,
        agent,
        task,
        status,
        output,
        actions,
        messages,
        stderr,
        exitCode,
        usage,
      });
    });
  } else if (declaredList.length > 0) {
    declaredList.forEach((decl, index) => {
      const output = declaredList.length === 1 ? fallbackTotalOutput : '';
      subTasks.push({
        id: `subtask-${execution.toolCallId}-${index}`,
        index,
        agent: decl.agent,
        task: decl.task,
        status: execution.status === 'running'
          ? 'running'
          : execution.status === 'error' || execution.interrupted
            ? 'error'
            : 'success',
        output,
        actions: [],
      });
    });
  } else {
    const progress = extractSubagentProgress(execution);
    subTasks.push({
      id: `subtask-${execution.toolCallId}-0`,
      index: 0,
      agent: progress.agentName ?? 'subagent',
      task: progress.summary,
      status: execution.status === 'running'
        ? 'running'
        : execution.status === 'error' || execution.interrupted
          ? 'error'
          : 'success',
      output: progress.outputText,
      actions: [],
    });
  }

  return subTasks;
}
