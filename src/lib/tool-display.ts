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
    default:
      return null;
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
