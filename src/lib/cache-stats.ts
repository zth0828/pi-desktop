// 缓存失效（cache miss）检测的纯函数：口径仿写 pi dist/core/cache-stats.js（未公开导出）。
// 与 pi 的差异：渲染层拿不到 models 注册表，readPerToken 在无 cacheRead 时退化为 0
//（pi 会回退到模型价目表的 cacheRead 费率）；branch_summary 条目壳侧不存在，不处理。

/** prompt 缓存 TTL：闲置超过该时长的 miss 大概率是缓存自然过期（Anthropic 默认 5 分钟） */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** 单轮 miss 低于该值视为缓存断点粒度噪声，不计 */
export const CACHE_MISS_NOISE_FLOOR = 1024;

export type CacheMiss = {
  /** 本应命中缓存却被重新计费的 prompt token 数 */
  missedTokens: number;
  /** 多付的成本（按本条消息自己的付费费率与缓存读费率差估算） */
  missedCost: number;
  /** 距上一轮的时间间隔（ms），用于闲置归因 */
  idleMs: number;
  /** 模型是否切换（换模型全量重计费，计入但不豁免） */
  modelChanged: boolean;
};

type RawUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  costInput: number;
  costCacheRead: number;
  costCacheWrite: number;
};

type RawAssistantMessage = {
  usage: RawUsage;
  timestamp: number;
  modelKey: string;
};

/** 前一轮请求的快照（pi 的 PreviousRequest） */
type PreviousRequest = {
  promptTokens: number;
  modelKey: string;
  timestamp: number;
  /** 该会话是否曾有过缓存上报（区分「不支持缓存的 provider」与「整轮 miss」） */
  reportedCache: boolean;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readAssistant(raw: unknown): RawAssistantMessage | null {
  const m = raw as {
    usage?: Record<string, unknown>;
    timestamp?: unknown;
    provider?: unknown;
    model?: unknown;
  } | null;
  if (!m || typeof m !== 'object' || !m.usage || typeof m.usage !== 'object') return null;
  const cost = (m.usage.cost ?? {}) as Record<string, unknown>;
  return {
    usage: {
      input: num(m.usage.input ?? m.usage.prompt_tokens),
      cacheRead: num(m.usage.cacheRead),
      cacheWrite: num(m.usage.cacheWrite),
      costInput: num(cost.input),
      costCacheRead: num(cost.cacheRead),
      costCacheWrite: num(cost.cacheWrite),
    },
    timestamp: num(m.timestamp),
    modelKey: `${m.provider ?? ''}/${m.model ?? ''}`,
  };
}

/** 单条 assistant 消息相对上一轮的 miss 检测（pi detectMiss 的直译） */
function detectMiss(prev: PreviousRequest | undefined, message: RawAssistantMessage): CacheMiss | undefined {
  const { usage } = message;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  // 零缓存的轮次只在「此前有过缓存上报」时才算整轮 miss：
  // 只读缓存的 provider 是全 miss，而从不上报缓存的 provider 什么都不说明。
  if (!prev || promptTokens <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache)) {
    return undefined;
  }
  const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
  if (missedTokens <= CACHE_MISS_NOISE_FLOOR) return undefined;
  // 多付成本 = miss 的 token 按实际付费费率（input/cacheWrite，含写溢价）而非缓存读费率计费。
  // miss 的 token 只会落在 input 或 cacheWrite 桶里，付费费率直接取自本条消息的成本明细。
  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken = paidTokens > 0 ? (usage.costInput + usage.costCacheWrite) / paidTokens : 0;
  // pi 此处会回退到模型价目表的 cacheRead 费率；渲染层没有 models 注册表，退化为 0。
  const readPerToken = usage.cacheRead > 0 ? usage.costCacheRead / usage.cacheRead : 0;
  return {
    missedTokens,
    missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
    idleMs: Math.max(0, message.timestamp - prev.timestamp),
    modelChanged: message.modelKey !== prev.modelKey,
  };
}

function asPreviousRequest(
  message: RawAssistantMessage,
  reportedCache: boolean,
): PreviousRequest | undefined {
  const { usage } = message;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (promptTokens <= 0) return undefined;
  return {
    promptTokens,
    modelKey: message.modelKey,
    timestamp: message.timestamp,
    reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
  };
}

/**
 * 扫描消息列表，返回每条发生 cache miss 的 assistant 消息（按列表下标）。
 * compaction 摘要消息视作上下文合法变更，重置对比基准（同 pi 对 compaction entry 的处理）。
 */
export function collectCacheMisses(
  messages: ReadonlyArray<{ role: string; raw: unknown }>,
): Map<number, CacheMiss> {
  const misses = new Map<number, CacheMiss>();
  let prev: PreviousRequest | undefined;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'compactionSummary') {
      prev = undefined;
      continue;
    }
    if (message.role !== 'assistant') continue;
    const raw = readAssistant(message.raw);
    if (!raw) continue;
    const miss = detectMiss(prev, raw);
    if (miss) misses.set(i, miss);
    prev = asPreviousRequest(raw, prev?.reportedCache ?? false) ?? prev;
  }
  return misses;
}

/** token 数的紧凑展示（"45.2k" 风格） */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}
