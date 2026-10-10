// Review 面板的 diff 纯函数：标准 unified diff 的 hunk 解析、单 hunk patch 重建（git apply -R 用）、
// 以及非 git 目录降级汇总（从工具执行记录提取 edit/write 改动文件）。
//
// 与 tool-display.ts 的 parseDiffLines 不同：那边解析的是 pi edit 工具 details.diff 的
// 私有格式（"+12 content"），这里解析的是 `git diff` 的标准 unified diff。
import { editPreviewDiff } from './tool-display';

function writeContentDiff(content: unknown): string | undefined {
  if (typeof content !== 'string' || !content.trim()) return undefined;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed
    .split('\n')
    .map((line, idx) => `+${idx + 1} ${line}`)
    .join('\n');
}

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
  const normalized = diff.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  // split artifact：diff 以 \n 结尾时末尾多一个空串，先去掉
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

export type ReviewSessionFile = {
  path: string;
  diff?: string;
  added: number;
  deleted: number;
  editCount: number;
};

export type ReviewFallbackFile = {
  path: string;
  /** pi edit 工具 details.diff（私有格式，渲染用 tool-display.parseDiffLines） */
  diff?: string;
  added: number;
  deleted: number;
};

type ReviewListEntry = {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'conflicted';
  added: number;
  deleted: number;
};

export function stripWinPrefix(p: string): string {
  if (/^(?:[\\/]{2}\?[\\/]|[\\/]\?\?[\\/])unc[\\/]/i.test(p)) return `//${p.slice(8)}`;
  if (/^(?:[\\/]{2}\?[\\/]|[\\/]\?\?[\\/])/i.test(p)) return p.slice(4);
  return p;
}

export function normalizeLexicalPath(raw: string): string {
  const stripped = stripWinPrefix(raw).replace(/\\/g, '/');
  let root = '';
  let rest = stripped;
  const uncMatch = /^\/\/([^/]+(?:\/[^/]+)?)(?:\/(.*))?$/.exec(stripped);
  if (uncMatch) {
    root = `//${uncMatch[1]}/`;
    rest = uncMatch[2] ?? '';
  } else if (/^[a-zA-Z]:(?:\/|$)/.test(stripped)) {
    root = stripped.length === 2 ? `${stripped}/` : stripped.slice(0, 3);
    rest = stripped.slice(3);
  } else if (stripped.startsWith('/')) {
    root = '/';
    rest = stripped.slice(1);
  }
  const parts = rest.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!root) {
        stack.push('..');
      }
    } else {
      stack.push(part);
    }
  }
  if (!root) {
    return stack.join('/') || '.';
  }
  const joined = `${root}${stack.join('/')}`;
  if (root.endsWith('/') && joined !== root) {
    return joined.replace(/\/+$/, '');
  }
  return joined;
}

export function isAbsolutePath(filePath: string): boolean {
  const normalized = stripWinPrefix(filePath).replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[a-zA-Z]:(?:\/|$)/.test(normalized);
}

export function isPathInside(childPath: string, parentDir?: string): boolean {
  if (!parentDir) return false;
  const child = normalizeLexicalPath(childPath);
  const parent = normalizeLexicalPath(parentDir);
  if (!isAbsolutePath(child)) {
    return !child.startsWith('../') && child !== '..';
  }
  if (!isAbsolutePath(parent)) {
    return false;
  }
  const isWindows = /^[a-zA-Z]:/.test(child) || /^[a-zA-Z]:/.test(parent) || child.startsWith('//') || parent.startsWith('//');
  const a = isWindows ? child.toLowerCase() : child;
  const b = isWindows ? parent.toLowerCase() : parent;
  const bWithSlash = b.endsWith('/') ? b : `${b}/`;
  if (a === b || a.startsWith(bWithSlash)) return true;
  const privateParent = b.startsWith('/private/')
    ? b.slice('/private'.length)
    : `/private${b}`;
  const privateWithSlash = privateParent.endsWith('/') ? privateParent : `${privateParent}/`;
  return a === privateParent || a.startsWith(privateWithSlash);
}

/** 规范化文件展示路径：相对 cwd 的文件去除前缀，外部绝对路径保持原样。 */
export function normalizeDisplayPath(filePath: string, cwd?: string): string {
  const child = normalizeLexicalPath(filePath);
  if (!cwd) return child;
  const root = normalizeLexicalPath(cwd);
  const isWindows = /^[a-zA-Z]:/.test(child) || /^[a-zA-Z]:/.test(root) || child.startsWith('//') || root.startsWith('//');
  const a = isWindows ? child.toLowerCase() : child;
  const b = isWindows ? root.toLowerCase() : root;
  if (a === b) return '.';
  const bWithSlash = b.endsWith('/') ? b : `${b}/`;
  if (a.startsWith(bWithSlash)) {
    return child.slice(bWithSlash.length);
  }
  const privateRoot = b.startsWith('/private/')
    ? b.slice('/private'.length)
    : `/private${b}`;
  const privateWithSlash = privateRoot.endsWith('/') ? privateRoot : `${privateRoot}/`;
  if (a === privateRoot) return '.';
  if (a.startsWith(privateWithSlash)) {
    return child.slice(privateWithSlash.length);
  }
  return child;
}

/**
 * 提取本会话内所有 edit/write 工具修改过的文件（历史会话与实时会话均可用）。
 * 路径按 cwd 规范化为工作区相对路径或外部绝对路径，同一文件记录多次编辑次数与最新 diff。
 */
export function sessionChangeFiles(
  toolExecutions: Record<string, {
    toolName: string;
    status: string;
    args?: unknown;
    result?: unknown;
  }>,
  cwd?: string,
): ReviewSessionFile[] {
  const byPath = new Map<string, ReviewSessionFile>();
  for (const ex of Object.values(toolExecutions)) {
    if (ex.toolName !== 'edit' && ex.toolName !== 'write') continue;
    if (ex.status !== 'success') continue;
    const args = ex.args as Record<string, unknown> | undefined;
    const rawPath =
      (typeof args?.path === 'string' && args.path) ||
      (typeof args?.file_path === 'string' && args.file_path) ||
      '';
    if (!rawPath) continue;
    const displayPath = normalizeDisplayPath(rawPath, cwd);

    const details =
      ex.result && typeof ex.result === 'object'
        ? (ex.result as { details?: unknown }).details
        : undefined;
    const realDiff =
      details && typeof details === 'object' && typeof (details as { diff?: unknown }).diff === 'string'
        ? (details as { diff: string }).diff
        : undefined;
    const previewDiff = !realDiff && ex.toolName === 'edit' ? editPreviewDiff(ex.args) : undefined;
    const writeDiff = !realDiff && ex.toolName === 'write' ? writeContentDiff(args?.content) : undefined;
    const diff = realDiff ?? previewDiff ?? writeDiff;

    let added = 0;
    let deleted = 0;
    if (diff) {
      for (const line of diff.split('\n')) {
        if (/^\+\s*\d*/.test(line)) added += 1;
        else if (/^-\s*\d*/.test(line)) deleted += 1;
      }
    } else if (ex.toolName === 'write' && typeof args?.content === 'string') {
      const lines = args.content.split('\n');
      added = args.content ? lines.length - (args.content.endsWith('\n') ? 1 : 0) : 0;
    }

    const key = /^[a-zA-Z]:/.test(displayPath) ? displayPath.toLowerCase() : displayPath;
    const existing = byPath.get(key);
    byPath.set(key, {
      path: existing?.path ?? displayPath,
      diff: diff ?? existing?.diff,
      added,
      deleted,
      editCount: (existing?.editCount ?? 0) + 1,
    });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * baseline 负责工作区内的实时状态；工具记录只在 baseline 不可用时兜底，或补入
 * 工作区外的绝对路径。这样回滚后文件会从列表消失，同时跨目录改动不会丢失。
 */
export function mergeReviewFiles(
  cwd: string | undefined,
  baselineAvailable: boolean,
  baselineFiles: ReviewListEntry[],
  toolFiles: (ReviewFallbackFile | ReviewSessionFile)[],
): ReviewListEntry[] {
  const byPath = new Map<string, ReviewListEntry>();
  for (const file of baselineFiles) {
    const key = /^[a-zA-Z]:/.test(file.path) ? file.path.toLowerCase() : file.path;
    byPath.set(key, file);
  }
  for (const file of toolFiles) {
    const isAbs = isAbsolutePath(file.path);
    const insideWorkspace = isAbs ? isPathInside(file.path, cwd) : true;
    if (baselineAvailable && insideWorkspace) continue;
    const displayPath = normalizeDisplayPath(file.path, cwd);
    const key = /^[a-zA-Z]:/.test(displayPath) ? displayPath.toLowerCase() : displayPath;
    if (!byPath.has(key)) {
      byPath.set(key, {
        path: displayPath,
        status: 'modified',
        added: file.added,
        deleted: file.deleted,
      });
    }
  }
  return [...byPath.values()];
}

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
    const rawPath =
      (typeof args?.path === 'string' && args.path) ||
      (typeof args?.file_path === 'string' && args.file_path) ||
      '';
    if (!rawPath) continue;
    const path = normalizeLexicalPath(rawPath).replace(/^\.\//, '');
    const key = /^[a-zA-Z]:/.test(path) ? path.toLowerCase() : path;
    const details =
      ex.result && typeof ex.result === 'object'
        ? (ex.result as { details?: unknown }).details
        : undefined;
    const realDiff =
      details && typeof details === 'object' && typeof (details as { diff?: unknown }).diff === 'string'
        ? ((details as { diff: string }).diff)
        : undefined;
    const previewDiff = !realDiff && ex.toolName === 'edit' ? editPreviewDiff(ex.args) : undefined;
    const writeDiff = !realDiff && ex.toolName === 'write' ? writeContentDiff(args?.content) : undefined;
    const diff = realDiff ?? previewDiff ?? writeDiff;
    let added = 0;
    let deleted = 0;
    if (diff) {
      for (const line of diff.split('\n')) {
        if (/^\+\s*\d*/.test(line)) added += 1;
        else if (/^-\s*\d*/.test(line)) deleted += 1;
      }
    } else if (ex.toolName === 'write' && typeof args?.content === 'string') {
      const lines = args.content.split('\n');
      added = args.content ? lines.length - (args.content.endsWith('\n') ? 1 : 0) : 0;
    }
    const existing = byPath.get(key);
    byPath.set(key, { path: existing?.path ?? path, diff, added, deleted });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
