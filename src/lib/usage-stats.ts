// 会话 usage 累计的纯函数，对齐 pi TUI footer 口径：
// 命中率 CH% = cacheRead / (input + cacheRead + cacheWrite)，成本取 usage.cost.total 合计。

export type UsageTurn = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type UsageTotals = UsageTurn & {
  /** 会话累计成本（usage.cost.total 合计） */
  cost: number;
  /** 最新一轮（最后一条带 usage 的消息）的 usage，用于本轮命中率 */
  lastTurn: UsageTurn | null;
};

function readUsage(raw: unknown): (UsageTurn & { cost: number }) | null {
  const usage = (raw as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (!usage) return null;
  const cost = usage.cost as { total?: unknown } | undefined;
  return {
    input: Number(usage.input ?? usage.prompt_tokens ?? 0),
    output: Number(usage.output ?? usage.completion_tokens ?? 0),
    cacheRead: Number(usage.cacheRead ?? 0),
    cacheWrite: Number(usage.cacheWrite ?? 0),
    cost: Number(cost?.total ?? 0),
  };
}

export function summarizeUsage(messages: ReadonlyArray<{ raw: unknown }>): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, lastTurn: null };
  for (const message of messages) {
    const usage = readUsage(message.raw);
    if (!usage) continue;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    totals.cost += usage.cost;
    totals.lastTurn = {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    };
  }
  return totals;
}

/** 缓存命中率（0-1）；分母为 0 时返回 null，表示不展示 */
export function cacheHitRate(turn: Pick<UsageTurn, 'input' | 'cacheRead' | 'cacheWrite'>): number | null {
  const denominator = turn.input + turn.cacheRead + turn.cacheWrite;
  if (denominator <= 0) return null;
  return turn.cacheRead / denominator;
}

export function formatHitRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 成本展示：不足 $1 给 4 位小数，$1 以上给 2 位 */
export function formatCost(cost: number): string {
  return `$${cost >= 1 ? cost.toFixed(2) : cost.toFixed(4)}`;
}
