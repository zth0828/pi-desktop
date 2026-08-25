import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * pi 内置模型目录映射：pi 的模型定义包 @earendil-works/pi-ai 自带静态目录
 * dist/providers/data/*.json（anthropic/openai/google/deepseek/openrouter 等，
 * 每条含官方 contextWindow/maxTokens/cost/input/reasoning）。
 * 第三方网关（agentrouter 等）的模型元数据直接复用这份官方数据，
 * 不再手工维护规格表。
 */

export type BuiltinModelRecord = {
  /** 基础模型 id（已去 provider 前缀，如 claude-opus-4.8） */
  id: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  reasoning?: boolean;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type BuiltinModelCatalog = Map<string, BuiltinModelRecord>;

/**
 * id 规范化（索引与查询共用）：
 * - 取斜杠最后一段（openrouter 风格 `anthropic/claude-opus-4.8` → 基础名）
 * - 小写
 * - 数字间版本分隔符统一为 `-`（anthropic 横杠风格 ↔ OpenRouter/agentrouter 点号风格：
 *   claude-opus-4-8 ≡ claude-opus-4.8）
 * - 剥离 `:batch`/`:free` 类路由后缀
 */
export function normalizeBuiltinModelId(modelId: string): string {
  const base = modelId.includes('/') ? modelId.split('/').pop() ?? modelId : modelId;
  return base
    .toLowerCase()
    .replace(/:[a-z-]+$/, '')
    .replace(/(\d)[.-](\d)/g, '$1-$2');
}

type RawCatalogModel = {
  id?: unknown;
  provider?: unknown;
  contextWindow?: unknown;
  maxTokens?: unknown;
  input?: unknown;
  reasoning?: unknown;
  cost?: unknown;
};

function toRecord(raw: RawCatalogModel): BuiltinModelRecord | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;
  const record: BuiltinModelRecord = { id };
  if (typeof raw.contextWindow === 'number' && raw.contextWindow > 0) {
    record.contextWindow = raw.contextWindow;
  }
  if (typeof raw.maxTokens === 'number' && raw.maxTokens > 0) {
    record.maxTokens = raw.maxTokens;
  }
  if (Array.isArray(raw.input)) {
    const input = raw.input.filter((kind): kind is string => typeof kind === 'string');
    if (input.length > 0) record.input = input;
  }
  if (typeof raw.reasoning === 'boolean') record.reasoning = raw.reasoning;
  if (raw.cost && typeof raw.cost === 'object') {
    const cost = raw.cost as Record<string, unknown>;
    const numeric = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const converted = {
      input: numeric(cost.input),
      output: numeric(cost.output),
      cacheRead: numeric(cost.cacheRead),
      cacheWrite: numeric(cost.cacheWrite),
    };
    if (Object.values(converted).some((value) => value !== undefined)) {
      record.cost = {
        input: converted.input ?? 0,
        output: converted.output ?? 0,
        cacheRead: converted.cacheRead ?? 0,
        cacheWrite: converted.cacheWrite ?? 0,
      };
    }
  }
  return record;
}

/**
 * 读取 pi-ai 静态目录。聚合网关（openrouter 等）转报的规格与官方目录冲突时
 * 保留官方（先读官方文件、后读网关不覆盖），如 deepseek 官方 max 384,000
 * vs openrouter 393,216。
 */
export function loadBuiltinModelCatalogFromDir(dataDir: string): BuiltinModelCatalog {
  const catalog: BuiltinModelCatalog = new Map();
  let files: string[];
  try {
    files = readdirSync(dataDir).filter((file) => file.endsWith('.json'));
  } catch {
    return catalog;
  }
  // openrouter 等聚合网关排最后：官方供应商目录先入索引
  files.sort((a, b) => Number(isAggregatorFile(a)) - Number(isAggregatorFile(b)));
  for (const file of files) {
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;
    for (const apiGroup of Object.values(doc as Record<string, unknown>)) {
      if (!apiGroup || typeof apiGroup !== 'object') continue;
      for (const raw of Object.values(apiGroup as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object') continue;
        const record = toRecord(raw as RawCatalogModel);
        if (!record) continue;
        const key = normalizeBuiltinModelId(record.id);
        if (!key || catalog.has(key)) continue;
        catalog.set(key, record);
      }
    }
  }
  return catalog;
}

function isAggregatorFile(file: string): boolean {
  // 聚合网关转报多家厂商模型，规格可能与官方有出入：仅做未收录时的补充
  return /^(openrouter|opencode|cloudflare|github-copilot|huggingface|together|fireworks|baseten|azure|amazon-bedrock|google-vertex)/.test(file);
}

let cachedCatalog: BuiltinModelCatalog | null = null;

/**
 * 经 pi 包根定位 pi-ai 数据目录，兼容三种安装布局（路径全部由 packageRoot
 * 动态推导，不硬编码）：
 * 1. npm 全局：依赖提升到同级 node_modules（dirname(packageRoot)/@earendil-works/pi-ai）
 * 2. npm 嵌套：包内 node_modules/@earendil-works/pi-ai
 * 3. pnpm：packageRoot 是符号链接，realpath 后位于 .pnpm 隔离区，pi-ai 在同级
 * pi-ai 是 ESM-only 包（exports 无 CJS 条件），无法用 require.resolve 定位，
 * 直接探测 dist/providers/data 目录。失败返回空目录，调用方回退保守缺省。
 */
export function loadBuiltinModelCatalog(piPackageRoot: string): BuiltinModelCatalog {
  if (cachedCatalog) return cachedCatalog;
  const candidates = [
    path.join(piPackageRoot, 'node_modules', '@earendil-works', 'pi-ai'),
    path.join(path.dirname(piPackageRoot), '@earendil-works', 'pi-ai'),
  ];
  try {
    const realRoot = realpathSync(piPackageRoot);
    if (realRoot !== piPackageRoot) {
      candidates.push(path.join(path.dirname(realRoot), '@earendil-works', 'pi-ai'));
    }
  } catch { /* realpath 失败时用前两个候选 */ }
  cachedCatalog = new Map();
  for (const base of candidates) {
    const catalog = loadBuiltinModelCatalogFromDir(path.join(base, 'dist', 'providers', 'data'));
    if (catalog.size > 0) {
      cachedCatalog = catalog;
      break;
    }
  }
  return cachedCatalog;
}

export function findBuiltinModel(
  catalog: BuiltinModelCatalog,
  modelId: string,
): BuiltinModelRecord | undefined {
  return catalog.get(normalizeBuiltinModelId(modelId));
}

/** 测试辅助：清空进程级缓存。 */
export function resetBuiltinModelCatalogCache(): void {
  cachedCatalog = null;
}
