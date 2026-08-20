// .gitignore 感知的递归遍历：fd（pi 的 @ 补全通道）不可用时的回退实现。
// 逐层读取 .gitignore（深层规则覆盖浅层，等价于各文件依序追加、最后匹配者胜出），
// 目录被忽略时整棵子树剪枝（git 语义：被排除目录下的文件无法重新包含）。
// 与 fd 的差异（仅回退路径）：非 git 仓库目录同样应用 .gitignore，避免被忽略
// 的文件泄漏进补全面板——桌面壳这里宁可多过滤也不漏。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export const GITIGNORE_FILE = '.gitignore';

/** 一个 .gitignore 层级：matcher 只含该目录自身的规则，按「相对该目录」的路径求值。 */
export type IgnoreLevel = {
  /** 该 .gitignore 所在目录相对遍历根的路径（'' 表示根目录）。 */
  relDir: string;
  matcher: Ignore;
};

/** 读取并解析目录下的 .gitignore；不存在或读失败返回 null（该层不参与过滤）。 */
export async function readIgnoreLevel(root: string, dir: string, relDir: string): Promise<IgnoreLevel | null> {
  try {
    const content = await readFile(path.join(root, dir, GITIGNORE_FILE), 'utf8');
    return { relDir, matcher: ignore().add(content.split(/\r?\n/)) };
  } catch {
    return null;
  }
}

/**
 * 按 git 语义求值：从根到最深逐层判定，深层规则覆盖浅层
 * （ignore 包已处理单文件内的取反与注释/空行）。
 */
export function isIgnored(levels: IgnoreLevel[], rel: string): boolean {
  let ignored = false;
  for (const level of levels) {
    const relFromLevel = level.relDir === ''
      ? rel
      : rel.startsWith(level.relDir + '/')
        ? rel.slice(level.relDir.length + 1)
        : null;
    if (relFromLevel === null || relFromLevel === '') continue;
    const decision = level.matcher.test(relFromLevel);
    if (decision.ignored) ignored = true;
    else if (decision.unignored) ignored = false;
  }
  return ignored;
}

export type WalkOptions = {
  maxFiles: number;
  /** 始终跳过的目录名（不含路径）。 */
  excludedDirs?: ReadonlySet<string>;
};

/**
 * 递归收集文件（相对路径，posix 分隔符），跳过被 .gitignore 忽略的
 * 文件与目录。符号链接不跟随（避免循环）。
 */
export async function walkGitignoreAware(
  root: string,
  dir: string,
  out: string[],
  levels: IgnoreLevel[],
  options: WalkOptions,
): Promise<void> {
  const { maxFiles, excludedDirs = DEFAULT_EXCLUDED_DIRS } = options;
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch {
    return; // 读不了的目录跳过
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      // 目录被忽略 → 整棵子树剪枝。目录模式（如 build/）需要尾斜杠才能命中。
      if (isIgnored(levels, `${rel}/`)) continue;
      let nextLevels = levels;
      const ownLevel = await readIgnoreLevel(root, rel, rel);
      if (ownLevel) nextLevels = [...levels, ownLevel];
      await walkGitignoreAware(root, rel, out, nextLevels, options);
    } else if (entry.isFile()) {
      if (isIgnored(levels, rel)) continue;
      out.push(rel);
    }
    // 符号链接不跟随（避免循环）
  }
}

export const DEFAULT_EXCLUDED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules']);
