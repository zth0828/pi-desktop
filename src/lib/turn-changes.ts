// 一轮对话的文件改动聚合（「已编辑 N 个文件 +x -y」卡片的数据源）。
// 口径：edit 从 result.details.diff 统计 +/-；write 新建文件按 args.content 行数计 +N -0。
// 同一文件多次改动合并累计，顺序按首次出现。
import type { ChatMessage, ToolExecution } from './chat-types';
import { parseDiffLines, resultDetails } from './tool-display';

/**
 * 逻辑轮（一轮对话）：user 消息开启新一轮，后续 assistant/toolResult 消息归入该轮。
 * pi 的 agent_start/agent_end 按模型往返触发（一个工具循环多个 run），不能当对话轮边界；
 * 渲染层统一按 user 消息位置归组（折叠/聚合卡的共同口径）。
 */
export type LogicalTurn = {
  /** 该轮 user 消息的下标 */
  startIndex: number;
  /** 该轮内的 toolCall block id（按消息顺序） */
  toolCallIds: string[];
  /** 该轮最后一条消息的下标（聚合编辑卡插入点） */
  endIndex: number;
};

export type TurnStage = {
  key: string;
  indices: number[];
};

/**
 * 将一轮里的过程消息按“重要阶段”聚合：带 toolCall 的 assistant 消息开启新阶段，
 * 后续 toolResult 与连续思考归入该阶段。这样模型多次增量思考不会制造大量折叠行。
 */
export function groupTurnStages(messages: ChatMessage[], indices: number[], keyPrefix: string): TurnStage[] {
  const stages: TurnStage[] = [];
  let current: TurnStage | undefined;
  for (const index of indices) {
    const message = messages[index];
    const startsToolStage = message.role === 'assistant'
      && message.content.some((block) => block.type === 'toolCall');
    if (!current || (startsToolStage && current.indices.some((entry) => messages[entry].role === 'assistant'
      && messages[entry].content.some((block) => block.type === 'toolCall')))) {
      current = { key: `${keyPrefix}:${stages.length}`, indices: [] };
      stages.push(current);
    }
    current.indices.push(index);
  }
  return stages;
}

/** 按 user 消息边界把消息列表切成逻辑轮；首条 user 之前的消息不属于任何轮 */
export function groupLogicalTurns(messages: ChatMessage[]): LogicalTurn[] {
  const turns: LogicalTurn[] = [];
  let current: LogicalTurn | null = null;
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      current = { startIndex: i, toolCallIds: [], endIndex: i };
      turns.push(current);
      return;
    }
    if (!current) return;
    current.endIndex = i;
    for (const b of m.content) {
      if (b.type === 'toolCall' && b.id) current.toolCallIds.push(b.id);
    }
  });
  return turns;
}

/**
 * 一轮完成后可视为最终答复的 assistant 消息：包含非空文本，且自身不再发起工具调用。
 * 壳只依赖 pi 的原始消息结构判断，不分析或改写模型语义。
 */
export function turnFinalResponseIndex(messages: ChatMessage[], turn: LogicalTurn): number | undefined {
  for (let i = turn.endIndex; i > turn.startIndex; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const hasText = message.content.some((block) => block.type === 'text' && block.text?.trim());
    const hasToolCall = message.content.some((block) => block.type === 'toolCall');
    if (hasText && !hasToolCall) return i;
  }
  return undefined;
}

/** 一轮的耗时范围：该轮工具执行的 min(startedAt) → max(endedAt)；无时间戳则为空 */
export function turnTimeRange(
  toolExecutions: Record<string, ToolExecution>,
  toolCallIds: string[],
): { startedAt?: number; endedAt?: number } {
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  for (const id of toolCallIds) {
    const ex = toolExecutions[id];
    if (!ex) continue;
    if (ex.startedAt !== undefined && (startedAt === undefined || ex.startedAt < startedAt)) {
      startedAt = ex.startedAt;
    }
    if (ex.endedAt !== undefined && (endedAt === undefined || ex.endedAt > endedAt)) {
      endedAt = ex.endedAt;
    }
  }
  return { startedAt, endedAt };
}

/**
 * 计算一轮回合的可展示耗时。
 *
 * 实时回合优先使用 run 统计传入的精确耗时；历史回合则以消息时间戳和工具
 * 执行时间戳的最小/最大值兜底。缺少两类时间信息时返回 null，避免伪造耗时。
 */
export function turnDurationMs(
  messages: ChatMessage[],
  turn: LogicalTurn,
  toolExecutions: Record<string, ToolExecution>,
  fallbackMs?: number,
): number | null {
  if (fallbackMs !== undefined && Number.isFinite(fallbackMs) && fallbackMs >= 0) return fallbackMs;
  const range = turnTimeRange(toolExecutions, turn.toolCallIds);
  const timestamps = messages
    .slice(turn.startIndex, turn.endIndex + 1)
    .map((message) => message.timestamp)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const starts = [range.startedAt, ...timestamps].filter((value): value is number => value !== undefined);
  const ends = [range.endedAt, ...timestamps].filter((value): value is number => value !== undefined);
  if (starts.length === 0 || ends.length === 0) return null;
  const startedAt = Math.min(...starts);
  const endedAt = Math.max(...ends);
  return endedAt >= startedAt ? endedAt - startedAt : null;
}

export type TurnFileChange = {
  path: string;
  added: number;
  deleted: number;
};

export type TurnChanges = {
  files: TurnFileChange[];
  added: number;
  deleted: number;
};

function argsPath(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const path = a.path ?? a.file_path;
  return typeof path === 'string' && path.trim() ? path : null;
}

/** write 新建文件的行数（与 review 面板口径一致：末尾换行不多算一行） */
function contentLines(content: string): number {
  if (!content) return 0;
  const lines = content.split('\n');
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
}

/** 汇总一轮（toolCallIds）里成功的 edit/write 执行，得到文件清单与增删统计 */
export function collectTurnChanges(
  toolExecutions: Record<string, ToolExecution>,
  toolCallIds: string[],
): TurnChanges {
  const byPath = new Map<string, TurnFileChange>();
  const bump = (path: string, added: number, deleted: number) => {
    const entry = byPath.get(path) ?? { path, added: 0, deleted: 0 };
    entry.added += added;
    entry.deleted += deleted;
    byPath.set(path, entry);
  };
  for (const id of toolCallIds) {
    const ex = toolExecutions[id];
    if (!ex || ex.status !== 'success') continue;
    const path = argsPath(ex.args);
    if (!path) continue;
    if (ex.toolName === 'edit') {
      const details = resultDetails(ex.result);
      const diff = typeof details?.diff === 'string' ? details.diff : undefined;
      if (!diff) continue;
      let added = 0;
      let deleted = 0;
      for (const line of parseDiffLines(diff)) {
        if (line.kind === 'add') added += 1;
        else if (line.kind === 'del') deleted += 1;
      }
      bump(path, added, deleted);
    } else if (ex.toolName === 'write') {
      const content = (ex.args as Record<string, unknown>).content;
      bump(path, typeof content === 'string' ? contentLines(content) : 0, 0);
    }
  }
  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((sum, f) => sum + f.added, 0),
    deleted: files.reduce((sum, f) => sum + f.deleted, 0),
  };
}
