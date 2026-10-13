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
 * 尝试将 JSON 字符串解析为对象，以兼容 OpenAI 格式的 arguments 字符串。
 */
export function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * 格式化参数对象，用于卡片与面板中的参数展示。
 */
export function formatToolArgs(args: unknown): string {
  if (args === undefined || args === null) return '';
  const parsed = tryParseJson(args);
  if (typeof parsed === 'string') return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
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
    if (typeof r.response === 'string' && r.response.trim()) return r.response.trim();
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
      } else if (distinctAgents.length > 1) {
        summary = `${distinctAgents.join(', ')} (${details.results.length})`;
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
  output?: string;
  isError?: boolean;
}

/**
 * 结构化的单项子任务信息。
 */
export interface SubagentSubTask {
  id: string;
  index: number;
  agent: string;
  task: string;
  status: 'running' | 'success' | 'error' | 'interrupted';
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
 * 格式化单条工具调用的单行简短摘要。
 */
export function formatActionSummary(toolName: string, args: unknown): string {
  const parsedArgs = tryParseJson(args);
  if (!parsedArgs || typeof parsedArgs !== 'object') return toolName;
  const a = parsedArgs as Record<string, unknown>;

  if (toolName === 'read' && typeof a.path === 'string') {
    return `${a.path}`;
  }
  if (toolName === 'bash' && typeof a.command === 'string') {
    return `$ ${a.command}`;
  }
  if (toolName === 'grep') {
    const q = a.query ?? a.pattern ?? '';
    const p = a.path ?? '';
    return p ? `${q} in ${p}` : String(q);
  }
  if (toolName === 'ls' && typeof a.path === 'string') {
    return `${a.path}`;
  }
  if ((toolName === 'write' || toolName === 'edit') && typeof a.path === 'string') {
    return `${a.path}`;
  }

  const custom = toolSummary(toolName, parsedArgs);
  if (custom) return custom;
  return formatToolArgs(parsedArgs).slice(0, 100);
}

/**
 * 从消息历史记录中解析出工具调用（toolCall / tool_use）及其对应的执行结果。
 */
export function parseActionTraces(messages: unknown): SubagentActionTrace[] {
  if (!Array.isArray(messages)) return [];
  const traces: SubagentActionTrace[] = [];
  const traceMap = new Map<string, SubagentActionTrace>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as {
      role?: string;
      content?: unknown;
      toolCallId?: string;
      tool_use_id?: string;
      tool_call_id?: string;
      isError?: boolean;
      is_error?: boolean;
      status?: unknown;
    };
    if (!msg || typeof msg !== 'object') continue;

    if (msg.role === 'assistant') {
      const contentList = Array.isArray(msg.content) ? msg.content : [];
      const toolCalls = Array.isArray((msg as unknown as Record<string, unknown>).toolCalls)
        ? ((msg as unknown as Record<string, unknown>).toolCalls as unknown[])
        : Array.isArray((msg as unknown as Record<string, unknown>).tool_calls)
          ? ((msg as unknown as Record<string, unknown>).tool_calls as unknown[])
          : [];
      const items = [...contentList, ...toolCalls];
      for (let j = 0; j < items.length; j++) {
        const item = items[j] as {
          type?: string;
          id?: string;
          name?: string;
          function?: { name?: string; arguments?: unknown };
          arguments?: unknown;
          input?: unknown;
          args?: unknown;
        };
        const toolName = item?.name ?? item?.function?.name;
        // 兼容 pi 原生 toolCall 与标准 tool_use / function call
        if (item && (item.type === 'toolCall' || item.type === 'tool_use' || item.type === 'function' || toolName) && toolName) {
          const rawArgs = item.arguments ?? item.input ?? item.args ?? item.function?.arguments;
          const inputArgs = tryParseJson(rawArgs);
          const summary = formatActionSummary(toolName, inputArgs);
          const id = item.id || `trace-${i}-${j}`;
          const traceItem: SubagentActionTrace = {
            id,
            toolName,
            summary: summary || toolName,
            args: inputArgs,
            output: '',
            isError: false,
          };
          traces.push(traceItem);
          traceMap.set(id, traceItem);
        }
      }
    } else if (msg.role === 'toolResult' || msg.role === 'tool') {
      const callId = msg.toolCallId || msg.tool_use_id || (msg as unknown as Record<string, unknown>).tool_call_id;
      if (callId && typeof callId === 'string' && traceMap.has(callId)) {
        const target = traceMap.get(callId)!;
        target.isError = Boolean(msg.isError || msg.is_error || msg.status === 'error');
        const text = extractSubagentText(msg.content ?? (msg as unknown as Record<string, unknown>).output ?? (msg as unknown as Record<string, unknown>).result);
        if (text) target.output = text;
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

  // 2. 从 messages 中倒序查找最后一条 assistant 消息包含的文本
  if (Array.isArray(res.messages)) {
    for (let i = res.messages.length - 1; i >= 0; i--) {
      const m = res.messages[i] as { role?: string; content?: unknown };
      if (m && m.role === 'assistant') {
        if (typeof m.content === 'string' && m.content.trim()) {
          return m.content.trim();
        }
        if (Array.isArray(m.content)) {
          const textParts = m.content
            .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim())
            .map((b: any) => b.text.trim());
          if (textParts.length > 0) {
            return textParts.join('\n\n');
          }
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
        : (typeof args.instruction === 'string' && args.instruction.trim())
          ? args.instruction.trim()
          : (typeof args.description === 'string' && args.description.trim())
            ? args.description.trim()
            : (typeof args.goal === 'string' && args.goal.trim())
              ? args.goal.trim()
              : (typeof args.message === 'string' && args.message.trim())
                ? args.message.trim()
                : (typeof args.input === 'string' && args.input.trim())
                  ? args.input.trim()
                  : '';
    if (singleTask) {
      const singleAgent = (typeof args.agent === 'string' && args.agent.trim())
        ? args.agent.trim()
        : (typeof args.name === 'string' && args.name.trim())
          ? args.name.trim()
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

      const status: SubagentSubTask['status'] = execution.interrupted
        ? 'interrupted'
        : execution.status === 'running'
          ? 'running'
          : isFailed || execution.status === 'error'
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
        status: execution.interrupted
          ? 'interrupted'
          : execution.status === 'running'
            ? 'running'
            : execution.status === 'error'
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
      status: execution.interrupted
        ? 'interrupted'
        : execution.status === 'running'
          ? 'running'
          : execution.status === 'error'
            ? 'error'
            : 'success',
      output: progress.outputText,
      actions: [],
    });
  }

  return subTasks;
}
