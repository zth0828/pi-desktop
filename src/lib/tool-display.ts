// 工具执行展示的纯函数：header 摘要、输出尾部裁剪、行级 diff 解析、耗时、截断警告。
// 展示口径对齐 pi TUI（core/tools/bash.js、core/tools/grep.js、
// modes/interactive/components/diff.js 的 parseDiffLine）。

/** pi 工具结果（含 partialResult）的文本提取：只取 content[].text，details 另作结构化解析 */
export function extractResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .filter(Boolean)
    .join('\n');
}

/** 工具结果里的结构化 UI 数据（edit.diff、bash.truncation/fullOutputPath、grep 的 limit 标记等） */
export function resultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const details = (result as { details?: unknown }).details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined;
}

/** 按工具名从 args 提取 header 摘要；不适用时返回 null（调用方只显示工具名） */
export function toolSummary(toolName: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  switch (toolName) {
    case 'bash': {
      const command = str(a.command);
      return command ? `$ ${command}` : null;
    }
    case 'edit':
    case 'write':
    case 'read':
      return str(a.path) ?? str(a.file_path);
    case 'grep':
      return str(a.pattern);
    case 'subagent': {
      // subagent 扩展：single {agent, task} / parallel {tasks:[…]} / chain {chain:[…]}
      const agent = str(a.agent);
      if (agent) return agent;
      if (Array.isArray(a.chain)) return `chain ×${a.chain.length}`;
      if (Array.isArray(a.tasks)) return `parallel ×${a.tasks.length}`;
      return null;
    }
    case 'mcp': {
      // pi-mcp-adapter 代理工具：{tool: "<server>_<name>", args} 或搜索模式 {search: query}
      const tool = str(a.tool);
      if (tool) {
        // 命名约定 <server>_<tool>：按最后一个下划线拆 server / 工具名
        const idx = tool.lastIndexOf('_');
        return idx > 0 ? `${tool.slice(0, idx)} · ${tool.slice(idx + 1)}` : tool;
      }
      const search = str(a.search);
      return search ? `search: ${search}` : null;
    }
    default:
      // 扩展/MCP 等上游工具的通用兜底：不识别工具名，只按常见参数字段猜摘要，
      // 保证任何插件工具都有可读 header（壳只做展示，能力全来自 pi/插件）。
      return str(a.path) ?? str(a.file) ?? str(a.command) ?? str(a.query) ?? str(a.url);
  }
}

/** 折叠态输出预览：只留尾部 maxLines 行，hidden 为被裁掉的行数（pi bash 折叠态口径） */
export function tailLines(text: string, maxLines = 5): { lines: string[]; hidden: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { lines, hidden: 0 };
  return { lines: lines.slice(lines.length - maxLines), hidden: lines.length - maxLines };
}

export type DiffLine = {
  kind: 'add' | 'del' | 'context' | 'skip';
  /** diff 文本里携带的行号（可能为空，如省略行） */
  lineNum: string;
  content: string;
};

/**
 * 解析 pi edit 工具的 details.diff（"+12 content" / "-12 content" / " 12 content" / 省略行）。
 * 解析规则同 pi diff.js 的 parseDiffLine；无法识别的行按 skip 处理。
 */
export function parseDiffLines(diffText: string): DiffLine[] {
  return diffText.split('\n').map((line) => {
    const match = line.match(/^([+-\s])(\s*\d*)\s(.*)$/);
    if (!match) return { kind: 'skip', lineNum: '', content: line };
    const [, prefix, lineNum, content] = match;
    if (prefix === '+') return { kind: 'add', lineNum: lineNum.trim(), content };
    if (prefix === '-') return { kind: 'del', lineNum: lineNum.trim(), content };
    if (lineNum.trim()) return { kind: 'context', lineNum: lineNum.trim(), content };
    return { kind: 'skip', lineNum: '', content };
  });
}

/** 耗时展示（TUI "Took X.Xs" 口径）；时间戳缺失或异常时返回 null 表示不展示 */
export function formatDuration(startedAt?: number, endedAt?: number): string | null {
  if (startedAt === undefined || endedAt === undefined) return null;
  const ms = endedAt - startedAt;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 工作日志耗时（Codex "Worked for 1m 28s" 口径）：整秒取整，进位到分/时 */
export function formatWorkDuration(startedAt?: number, endedAt?: number): string | null {
  if (startedAt === undefined || endedAt === undefined) return null;
  const ms = endedAt - startedAt;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${totalMinutes % 60}m`;
}

/** 预览 diff 单侧（删/增）最多展示的行数，超出补省略行（避免整文件替换刷屏） */
const PREVIEW_DIFF_MAX_LINES = 60;

function previewSide(lines: string[], sign: '+' | '-'): string[] {
  const shown = lines.slice(0, PREVIEW_DIFF_MAX_LINES).map((l) => `${sign} ${l}`);
  if (lines.length > PREVIEW_DIFF_MAX_LINES) shown.push('     ...');
  return shown;
}

/**
 * edit 工具执行前的预览 diff：args 流式完成（old/new 齐全）但结果未回时，
 * 先按「整段替换」构造 pi diff 格式文本（"+ content" / "- content"，无行号），
 * 交给 parseDiffLines 渲染；真实 details.diff 到了之后由调用方替换掉。
 * 兼容两种 args 形态：{oldString, newString} 与 {edits: [{oldText, newText}, …]}。
 */
export function editPreviewDiff(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const a = args as Record<string, unknown>;
  const pairs: { oldText: string; newText: string }[] = [];
  if (typeof a.oldString === 'string' && typeof a.newString === 'string') {
    pairs.push({ oldText: a.oldString, newText: a.newString });
  }
  if (Array.isArray(a.edits)) {
    for (const e of a.edits) {
      if (!e || typeof e !== 'object') continue;
      const edit = e as Record<string, unknown>;
      const oldText = typeof edit.oldText === 'string' ? edit.oldText : undefined;
      const newText = typeof edit.newText === 'string' ? edit.newText : undefined;
      if (oldText !== undefined && newText !== undefined) pairs.push({ oldText, newText });
    }
  }
  if (pairs.length === 0) return undefined;
  const lines: string[] = [];
  for (const { oldText, newText } of pairs) {
    lines.push(...previewSide(oldText.split('\n'), '-'), ...previewSide(newText.split('\n'), '+'));
  }
  return lines.join('\n');
}

export type ToolWarning =
  | { kind: 'fullOutput'; path: string }
  | { kind: 'truncatedLines'; outputLines: number; totalLines: number }
  | { kind: 'truncatedBytes'; outputLines: number }
  | { kind: 'matchLimit'; limit: number }
  | { kind: 'linesTruncated' };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 从 details 收集截断/limit 警告（bash truncation/fullOutputPath、grep/find/ls 的 limit 标记） */
export function collectToolWarnings(details: Record<string, unknown> | undefined): ToolWarning[] {
  if (!details) return [];
  const warnings: ToolWarning[] = [];
  if (typeof details.fullOutputPath === 'string' && details.fullOutputPath) {
    warnings.push({ kind: 'fullOutput', path: details.fullOutputPath });
  }
  const truncation = details.truncation as Record<string, unknown> | undefined;
  if (truncation && typeof truncation === 'object' && truncation.truncated === true) {
    if (truncation.truncatedBy === 'lines') {
      warnings.push({
        kind: 'truncatedLines',
        outputLines: num(truncation.outputLines),
        totalLines: num(truncation.totalLines),
      });
    } else {
      warnings.push({ kind: 'truncatedBytes', outputLines: num(truncation.outputLines) });
    }
  }
  if (typeof details.matchLimitReached === 'number') {
    warnings.push({ kind: 'matchLimit', limit: details.matchLimitReached });
  }
  if (details.linesTruncated === true) {
    warnings.push({ kind: 'linesTruncated' });
  }
  return warnings;
}
