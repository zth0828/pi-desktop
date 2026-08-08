// Review 面板后端：会话改动的 git baseline 快照 + diff + 回滚（M6 Review MVP）。
//
// baseline 方案（为什么是 ghost commit 而不是 git stash create）：
// `git stash create` 只含已跟踪文件（不支持 -u），agent 新建文件不会进入 baseline，
// 之后 `git diff <stashRef>` 也永远看不到当前工作区的 untracked 文件。
// 这里改用临时 index 造 ghost commit（Codex 同款思路）：
//   GIT_INDEX_FILE=<tmp> git read-tree HEAD → git add -A → git write-tree → git commit-tree
// tree = 会话开始时的完整工作区（含未跟踪、不含 .gitignore 忽略项），commit 挂为 dangling
// 对象（不动工作区/index/HEAD，与 stash create 一样无副作用）。
// 面板数据同样是「baseline tree ↔ 当前磁盘快照 tree」的 tree-to-tree diff，
// 两侧同构，新建/删除/修改全部覆盖；磁盘快照每次请求重算，保持活视图。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HostSuccess,
  ReviewFileDiffPayload,
  ReviewFileDiffResult,
  ReviewFileEntry,
  ReviewRevertFilePayload,
  ReviewRevertHunkPayload,
  ReviewSummaryResult,
} from '@shared/host-api/contract';
import { getActiveRuntime } from './pi-runtime-api';

type GitResult = { code: number; stdout: string; stderr: string };

const GIT_TIMEOUT_MS = 30_000;

function runGit(cwd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`git ${args[0]} timed out`));
    }, GIT_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
    }
    child.stdin?.end();
  });
}

/** ghost commit 的提交身份（仓库/全局可能都没配 user.*，commit-tree 需要） */
const GHOST_IDENTITY_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'pi-desktop',
  GIT_AUTHOR_EMAIL: 'pi-desktop@localhost',
  GIT_COMMITTER_NAME: 'pi-desktop',
  GIT_COMMITTER_EMAIL: 'pi-desktop@localhost',
};

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return r.code === 0 && r.stdout.trim() === 'true';
  } catch {
    return false; // git 不存在等
  }
}

async function headRef(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * 用临时 index 把当前磁盘状态（含 untracked、排除 ignored）写成一个 tree 对象。
 * 不碰真实 index/工作区；返回 tree oid。
 */
async function snapshotTree(cwd: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pi-desktop-review-'));
  const env = { ...GHOST_IDENTITY_ENV, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const head = await headRef(cwd);
    // 以 HEAD（或空 tree）为底，add -A 叠加当前磁盘；空仓库（无 commit）走 --empty
    const readTree = await runGit(cwd, head ? ['read-tree', head] : ['read-tree', '--empty'], { env });
    if (readTree.code !== 0) throw new Error(readTree.stderr.trim() || 'git read-tree failed');
    const add = await runGit(cwd, ['add', '-A'], { env });
    if (add.code !== 0) throw new Error(add.stderr.trim() || 'git add failed');
    const writeTree = await runGit(cwd, ['write-tree'], { env });
    if (writeTree.code !== 0) throw new Error(writeTree.stderr.trim() || 'git write-tree failed');
    return writeTree.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Baseline = { cwd: string; ref: string };
let baseline: Baseline | null = null;
/** capture 失败原因（not-a-git-repo / git-error:…），供 getSummary 降级展示 */
let baselineFailure: string | null = null;

/**
 * 为会话建 baseline（runtime 创建时调用；同一 cwd 重复调用直接复用）。
 * 非 git 目录 → baseline=null，Review 面板降级为只读汇总。
 */
export async function captureReviewBaseline(cwd: string): Promise<void> {
  if (baseline?.cwd === cwd) return;
  baseline = null;
  baselineFailure = null;
  try {
    if (!(await isGitRepo(cwd))) {
      baselineFailure = 'not-a-git-repo';
      return;
    }
    const tree = await snapshotTree(cwd);
    const head = await headRef(cwd);
    const commit = await runGit(
      cwd,
      ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'pi-desktop review baseline'],
      { env: GHOST_IDENTITY_ENV },
    );
    if (commit.code !== 0) throw new Error(commit.stderr.trim() || 'git commit-tree failed');
    baseline = { cwd, ref: commit.stdout.trim() };
  } catch (err) {
    baseline = null;
    baselineFailure = `git-error:${err instanceof Error ? err.message : String(err)}`;
  }
}

/** runtime 销毁（cwd 切换）时清掉旧 baseline，避免串项目。 */
export function clearReviewBaseline(): void {
  baseline = null;
  baselineFailure = null;
}

/** 当前活动 runtime 的 baseline（cwd 不一致视为没有）。 */
function currentBaseline(): Baseline | null {
  const active = getActiveRuntime();
  if (!active) return null;
  return baseline && baseline.cwd === active.cwd ? baseline : null;
}

function unavailable(reason: string): ReviewSummaryResult {
  return { available: false, reason, files: [] };
}

/** --name-status（--no-renames：M/A/D 单字母） */
async function diffNameStatus(cwd: string, base: string, cur: string): Promise<Map<string, ReviewFileEntry['status']>> {
  const r = await runGit(cwd, ['diff', '--no-renames', '--name-status', base, cur]);
  const map = new Map<string, ReviewFileEntry['status']>();
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git diff failed');
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [letter, path] = line.split('\t');
    const status = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified';
    if (path) map.set(path, status);
  }
  return map;
}

/** --numstat：added/deleted 行数（binary 显示 '-'，按 0 计） */
async function diffNumstat(cwd: string, base: string, cur: string): Promise<Map<string, { added: number; deleted: number }>> {
  const r = await runGit(cwd, ['diff', '--no-renames', '--numstat', base, cur]);
  const map = new Map<string, { added: number; deleted: number }>();
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git diff failed');
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [added, deleted, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path) continue;
    map.set(path, {
      added: Number(added) || 0,
      deleted: Number(deleted) || 0,
    });
  }
  return map;
}

export const reviewApi = {
  getSummary: async (): Promise<ReviewSummaryResult> => {
    const active = getActiveRuntime();
    if (!active) return unavailable('not-started');
    const base = currentBaseline();
    if (!base) return unavailable(baselineFailure ?? 'not-a-git-repo');
    try {
      const cur = await snapshotTree(active.cwd);
      const [statuses, stats] = await Promise.all([
        diffNameStatus(active.cwd, base.ref, cur),
        diffNumstat(active.cwd, base.ref, cur),
      ]);
      const files: ReviewFileEntry[] = [];
      for (const [path, status] of statuses) {
        const s = stats.get(path) ?? { added: 0, deleted: 0 };
        files.push({ path, status, added: s.added, deleted: s.deleted });
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { available: true, files };
    } catch (err) {
      return unavailable(`git-error:${err instanceof Error ? err.message : String(err)}`);
    }
  },

  getFileDiff: async (payload: ReviewFileDiffPayload): Promise<ReviewFileDiffResult> => {
    const active = getActiveRuntime();
    const base = currentBaseline();
    if (!active || !base) {
      return { available: false, reason: baselineFailure ?? 'not-started', path: payload.path, diff: '' };
    }
    try {
      const cur = await snapshotTree(active.cwd);
      const r = await runGit(active.cwd, ['diff', '--no-renames', base.ref, cur, '--', payload.path]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || 'git diff failed');
      return { available: true, path: payload.path, diff: r.stdout };
    } catch (err) {
      return {
        available: false,
        reason: `git-error:${err instanceof Error ? err.message : String(err)}`,
        path: payload.path,
        diff: '',
      };
    }
  },

  /** 文件级回滚：baseline→当前 的整文件 diff 反向 apply（新增文件被删、删除文件被还原）。 */
  revertFile: async (payload: ReviewRevertFilePayload): Promise<HostSuccess> => {
    const active = getActiveRuntime();
    const base = currentBaseline();
    if (!active || !base) return { success: false, error: baselineFailure ?? 'not-started' };
    try {
      const cur = await snapshotTree(active.cwd);
      const diff = await runGit(active.cwd, ['diff', '--no-renames', base.ref, cur, '--', payload.path]);
      if (diff.code !== 0) throw new Error(diff.stderr.trim() || 'git diff failed');
      if (!diff.stdout.trim()) return { success: false, error: 'no changes to revert' };
      const apply = await runGit(active.cwd, ['apply', '-R'], { input: diff.stdout });
      if (apply.code !== 0) return { success: false, error: apply.stderr.trim() || 'git apply failed' };
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** hunk 级回滚：渲染层重建的单 hunk patch，直接 git apply -R（失败原文返回给 UI）。 */
  revertHunk: async (payload: ReviewRevertHunkPayload): Promise<HostSuccess> => {
    const active = getActiveRuntime();
    if (!active || !currentBaseline()) return { success: false, error: baselineFailure ?? 'not-started' };
    if (!payload.patch.trim()) return { success: false, error: 'empty patch' };
    try {
      const apply = await runGit(active.cwd, ['apply', '-R'], { input: payload.patch });
      if (apply.code !== 0) return { success: false, error: apply.stderr.trim() || 'git apply failed' };
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
