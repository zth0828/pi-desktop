// Review 面板的 diff 纯函数：标准 unified diff 的 hunk 解析、单 hunk patch 重建（git apply -R 用）、
// 以及非 git 目录降级汇总（从工具执行记录提取 edit/write 改动文件）。
//
// 与 tool-display.ts 的 parseDiffLines 不同：那边解析的是 pi edit 工具 details.diff 的
// 私有格式（"+12 content"），这里解析的是 `git diff` 的标准 unified diff。

export type ReviewHunk = {
  /** @@ -oldStart,oldLines +newStart,newLines @@ 整行原文 */
  header: string;
  /** hunk 内容行原文（含 ' ' / '+' / '-' / '\' 前缀） */
  lines: string[];
};

export type ParsedFileDiff = {
  /** diff --git / index / --- / +++ 等头部行原文（重建 patch 时原样带上） */
  headerLines: string[];
  hunks: ReviewHunk[];
};

/** 解析单文件标准 unified diff；没有 hunk（空 diff / 纯 mode 变更）返回 null。 */
export function parseUnifiedDiff(diff: string): ParsedFileDiff | null {
  const lines = diff.split('\n');
  // split  artifact：diff 以 \n 结尾时末尾多一个空串，先去掉
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const headerLines: string[] = [];
  const hunks: ReviewHunk[] = [];
  let current: ReviewHunk | null = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      current = { header: line, lines: [] };
      hunks.push(current);
    } else if (current) {
      // hunk 内容行：' '/'+'/'-' 前缀，'\ No newline at end of file' 标记行原样保留；
      // 空行按 git apply 的容忍语义视为空 context 行，原样保留
      current.lines.push(line);
    } else {
      headerLines.push(line);
    }
  }
  if (hunks.length === 0) return null;
  return { headerLines, hunks };
}

export type ReviewDiffLineKind = 'add' | 'del' | 'context' | 'marker';

export type SplitDiffCell = {
  kind: 'add' | 'del' | 'context' | 'empty';
  lineNumber: number | null;
  content: string;
};
export type SplitDiffRow = { old: SplitDiffCell; next: SplitDiffCell };

function hunkStarts(header: string): { old: number; next: number } {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return { old: Number(match?.[1] ?? 1), next: Number(match?.[2] ?? 1) };
}

/** Align delete/add runs into two columns while preserving context line numbers. */
export function buildSplitDiffRows(hunk: ReviewHunk): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let { old: oldLine, next: nextLine } = hunkStarts(hunk.header);
  for (let index = 0; index < hunk.lines.length;) {
    const line = hunk.lines[index];
    if (line.startsWith('\\')) {
      index += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      rows.push({
        old: { kind: 'context', lineNumber: oldLine++, content: line.slice(1) },
        next: { kind: 'context', lineNumber: nextLine++, content: line.slice(1) },
      });
      index += 1;
      continue;
    }
    const deleted: string[] = [];
    const added: string[] = [];
    while (index < hunk.lines.length && !hunk.lines[index].startsWith(' ')) {
      const changed = hunk.lines[index];
      if (changed.startsWith('-')) deleted.push(changed.slice(1));
      else if (changed.startsWith('+')) added.push(changed.slice(1));
      index += 1;
    }
    for (let offset = 0; offset < Math.max(deleted.length, added.length); offset += 1) {
      rows.push({
        old: deleted[offset] === undefined
          ? { kind: 'empty', lineNumber: null, content: '' }
          : { kind: 'del', lineNumber: oldLine++, content: deleted[offset] },
        next: added[offset] === undefined
          ? { kind: 'empty', lineNumber: null, content: '' }
          : { kind: 'add', lineNumber: nextLine++, content: added[offset] },
      });
    }
  }
  return rows;
}

/** hunk 内容行的展示分类（'\' 标记行单独一类，不配色） */
export function hunkLineKind(line: string): ReviewDiffLineKind {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('\\')) return 'marker';
  return 'context';
}

/**
 * 重建只含指定 hunk 的合法 unified diff（diff --git 头 + ---/+++ + @@ 行号全部保留原文），
 * 供 main 侧 `git apply -R` 做 hunk 级回滚。行号是 diff 生成时相对当前文件的，
 * git apply 自带偏移容忍；文件在 diff 生成后被外部改动导致 apply 失败时错误回显 UI。
 */
export function buildHunkPatch(parsed: ParsedFileDiff, hunkIndex: number): string {
  const hunk = parsed.hunks[hunkIndex];
  if (!hunk) throw new Error(`hunk index out of range: ${hunkIndex}`);
  return [...parsed.headerLines, hunk.header, ...hunk.lines].join('\n') + '\n';
}

export type ReviewFallbackFile = {
  path: string;
  /** pi edit 工具 details.diff（私有格式，渲染用 tool-display.parseDiffLines） */
  diff?: string;
};

/**
 * 非 git 目录降级汇总：从工具执行记录滤 edit/write 成功项，按路径去重（保留最后一次的 diff）。
 * toolExecutions 结构同 src/stores/chat.ts 的 ToolExecution（结构化最小声明，避免反向依赖 store）。
 */
export function collectFallbackFiles(
  toolExecutions: Record<string, {
    toolName: string;
    status: string;
    args?: unknown;
    result?: unknown;
  }>,
): ReviewFallbackFile[] {
  const byPath = new Map<string, ReviewFallbackFile>();
  for (const ex of Object.values(toolExecutions)) {
    if (ex.toolName !== 'edit' && ex.toolName !== 'write') continue;
    if (ex.status !== 'success') continue;
    const args = ex.args as Record<string, unknown> | undefined;
    const path =
      (typeof args?.path === 'string' && args.path) ||
      (typeof args?.file_path === 'string' && args.file_path) ||
      '';
    if (!path) continue;
    const details =
      ex.result && typeof ex.result === 'object'
        ? (ex.result as { details?: unknown }).details
        : undefined;
    const diff =
      details && typeof details === 'object' && typeof (details as { diff?: unknown }).diff === 'string'
        ? ((details as { diff: string }).diff)
        : undefined;
    byPath.set(path, { path, diff });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
