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

  const outputSource =
    execution.status === 'running' && execution.partialResult !== undefined
      ? execution.partialResult
      : execution.result;

  const outputText = extractSubagentText(outputSource);

  return {
    summary,
    agentName,
    outputText,
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
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

/**
 * 从消息历史记录中解析出工具调用（tool_use）轨迹。
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

    // 只关注 assistant 侧发起工具调用的消息
    if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const item = msg.content[j] as {
          type?: string;
          id?: string;
          name?: string;
          input?: unknown;
          args?: unknown;
        };
        if (item && item.type === 'tool_use' && item.name) {
          const toolName = item.name;
          const inputArgs = item.input ?? item.args;
          const summary = toolSummary(toolName, inputArgs) ?? formatToolArgs(inputArgs).slice(0, 80);
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
 * 从 ToolExecution 解析出所有拆分的子任务及其内部轨迹与独立输出。
 * 支持 pi-subagents 官方标准的 details.results，以及 tasks/chain 声明。
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
    const details = resObj.details;
    if (details && typeof details === 'object') {
      const detObj = details as Record<string, unknown>;
      if (Array.isArray(detObj.results)) {
        resultsFromDetails = detObj.results as Array<Record<string, unknown>>;
      }
    } else if (Array.isArray(resObj.results)) {
      resultsFromDetails = resObj.results as Array<Record<string, unknown>>;
    }
  }

  // 3. 构建聚合结果列表
  const subTasks: SubagentSubTask[] = [];

  // 如果有结构化详情结果，优先以此为基准建立子任务
  if (resultsFromDetails.length > 0) {
    resultsFromDetails.forEach((res, index) => {
      const agent = (typeof res.agent === 'string' && res.agent.trim())
        ? res.agent.trim()
        : declaredList[index]?.agent ?? 'subagent';
      const task = (typeof res.task === 'string' && res.task.trim())
        ? res.task.trim()
        : declaredList[index]?.task ?? '';
      const output = extractSubagentText(res.output ?? res.content ?? res.result ?? res);
      const actions = parseActionTraces(res.messages);

      const usage = res.usage && typeof res.usage === 'object'
        ? (res.usage as { input?: number; output?: number; total?: number })
        : undefined;

      const status: SubagentSubTask['status'] = execution.status === 'running'
        ? 'running'
        : res.error || execution.status === 'error'
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
        usage,
      });
    });
  } else if (declaredList.length > 0) {
    // 只有声明任务（例如执行中或纯文本返回）
    const totalOutput = extractSubagentText(resultSource);
    declaredList.forEach((decl, index) => {
      // 只有单任务时直接绑定完整输出；多任务未拆分时只在第一个挂载或保留为空
      const output = declaredList.length === 1 ? totalOutput : '';
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
    // 退化兼容单任务
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
