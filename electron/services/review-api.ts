// Review 面板后端：Git 仓库以启动时 HEAD 为基准；非 Git 目录以会话启动快照为基准。
//
// 当前磁盘始终由隔离的临时 index 快照，因此 staged、unstaged、untracked 都能形成
// 同一份 tree diff，又不会触碰真实 index/工作区。真实 index 只用于补充 unmerged 状态；
// 临时 index 会把冲突文件展平成普通工作区内容，不能单独承担冲突识别。
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

async function headRef(cwd: string, gitEnv?: NodeJS.ProcessEnv): Promise<string | null> {
  const r = await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], { env: gitEnv });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * 用临时 index 把当前磁盘状态（含 untracked、排除 ignored）写成一个 tree 对象。
 * 不碰真实 index/工作区；返回 tree oid。
 */
async function snapshotTree(
  cwd: string,
  gitEnv?: NodeJS.ProcessEnv,
  seedRef?: string | null,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pi-desktop-review-'));
  const env = { ...GHOST_IDENTITY_ENV, ...gitEnv, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const head = seedRef === undefined ? await headRef(cwd, gitEnv) : seedRef;
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

type Baseline = {
  cwd: string;
  ref: string;
  kind: 'git-head' | 'session-snapshot';
  gitEnv?: NodeJS.ProcessEnv;
  /** 非 Git 项目的临时 object store；baseline 清理时一并删除。 */
  ownedDir?: string;
};
const baselines = new Map<string, Baseline>();
/** capture 失败原因（git-error:…），供 getSummary 降级展示 */
let baselineFailure: string | null = null;

function disposeBaseline(): void {
  for (const entry of baselines.values()) {
    if (entry.ownedDir) rmSync(entry.ownedDir, { recursive: true, force: true });
  }
  baselines.clear();
}

/**
 * 为会话建 baseline（runtime 创建时调用；同一 cwd 重复调用直接复用）。
 * 非 Git 目录使用临时 bare object store，项目目录本身不会出现 .git。
 */
export async function captureReviewBaseline(cwd: string): Promise<void> {
  if (baselines.has(cwd)) return;
  baselineFailure = null;
  let ownedDir: string | undefined;
  try {
    let gitEnv: NodeJS.ProcessEnv | undefined;
    let parent: string | null = null;
    if (await isGitRepo(cwd)) {
      parent = await headRef(cwd);
      if (parent) {
        baselines.set(cwd, { cwd, ref: parent, kind: 'git-head' });
        return;
      }
    } else {
      ownedDir = mkdtempSync(join(tmpdir(), 'pi-desktop-review-repo-'));
      const gitDir = join(ownedDir, 'objects.git');
      const init = await runGit(cwd, ['init', '--bare', gitDir]);
      if (init.code !== 0) throw new Error(init.stderr.trim() || 'git init failed');
      gitEnv = { GIT_DIR: gitDir, GIT_WORK_TREE: cwd };
    }
    // Unborn Git repository compares against an empty tree. Non-Git workspaces
    // retain their complete session-start snapshot in the temporary object store.
    const tree = parent === null && !gitEnv
      ? (await runGit(cwd, ['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' })).stdout.trim()
      : await snapshotTree(cwd, gitEnv, parent);
    if (!tree) throw new Error('git empty tree failed');
    const commit = await runGit(
      cwd,
      ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'pi-desktop review baseline'],
      { env: { ...GHOST_IDENTITY_ENV, ...gitEnv } },
    );
    if (commit.code !== 0) throw new Error(commit.stderr.trim() || 'git commit-tree failed');
    baselines.set(cwd, { cwd, ref: commit.stdout.trim(), kind: gitEnv ? 'session-snapshot' : 'git-head', gitEnv, ownedDir });
  } catch (err) {
    if (ownedDir) rmSync(ownedDir, { recursive: true, force: true });
    baselineFailure = `git-error:${err instanceof Error ? err.message : String(err)}`;
  }
}

/** runtime 销毁（cwd 切换）时清掉旧 baseline，避免串项目。 */
export function clearReviewBaseline(): void {
  disposeBaseline();
  baselineFailure = null;
}

/** 当前活动 runtime 的 baseline（cwd 不一致视为没有）。 */
function currentBaseline(): Baseline | null {
  const active = getActiveRuntime();
  if (!active) return null;
  return baselines.get(active.cwd) ?? null;
}

function unavailable(reason: string): ReviewSummaryResult {
  return { available: false, reason, files: [] };
}

/** --name-status（--no-renames：M/A/D 单字母） */
async function diffNameStatus(cwd: string, base: string, cur: string, env?: NodeJS.ProcessEnv): Promise<Map<string, ReviewFileEntry['status']>> {
  const r = await runGit(cwd, ['diff', '--no-renames', '--name-status', base, cur], { env });
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
async function diffNumstat(cwd: string, base: string, cur: string, env?: NodeJS.ProcessEnv): Promise<Map<string, { added: number; deleted: number }>> {
  const r = await runGit(cwd, ['diff', '--no-renames', '--numstat', base, cur], { env });
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

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Read the real index because temporary snapshot indexes intentionally flatten conflicts. */
async function conflictPaths(cwd: string, base: Baseline): Promise<Set<string>> {
  if (base.kind !== 'git-head') return new Set();
  const result = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'git status failed');
  const paths = new Set<string>();
  for (const entry of result.stdout.split('\0')) {
    if (entry.length < 4 || !CONFLICT_CODES.has(entry.slice(0, 2))) continue;
    paths.add(entry.slice(3));
  }
  return paths;
}

export const reviewApi = {
  getSummary: async (): Promise<ReviewSummaryResult> => {
    const active = getActiveRuntime();
    if (!active) return unavailable('not-started');
    const base = currentBaseline();
    if (!base) return unavailable(baselineFailure ?? 'not-a-git-repo');
    try {
      const cur = await snapshotTree(active.cwd, base.gitEnv, base.ref);
      const [statuses, stats, conflicts] = await Promise.all([
        diffNameStatus(active.cwd, base.ref, cur, base.gitEnv),
        diffNumstat(active.cwd, base.ref, cur, base.gitEnv),
        conflictPaths(active.cwd, base),
      ]);
      for (const path of conflicts) statuses.set(path, 'conflicted');
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
      const cur = await snapshotTree(active.cwd, base.gitEnv, base.ref);
      const r = await runGit(active.cwd, ['diff', '--no-renames', base.ref, cur, '--', payload.path], { env: base.gitEnv });
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
      if ((await conflictPaths(active.cwd, base)).has(payload.path)) {
        return { success: false, error: 'conflicted files cannot be reverted from Review' };
      }
      const cur = await snapshotTree(active.cwd, base.gitEnv, base.ref);
      const diff = await runGit(active.cwd, ['diff', '--no-renames', base.ref, cur, '--', payload.path], { env: base.gitEnv });
      if (diff.code !== 0) throw new Error(diff.stderr.trim() || 'git diff failed');
      if (!diff.stdout.trim()) return { success: false, error: 'no changes to revert' };
      const apply = await runGit(active.cwd, ['apply', '-R'], { env: base.gitEnv, input: diff.stdout });
      if (apply.code !== 0) return { success: false, error: apply.stderr.trim() || 'git apply failed' };
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** hunk 级回滚：渲染层重建的单 hunk patch，直接 git apply -R（失败原文返回给 UI）。 */
  revertHunk: async (payload: ReviewRevertHunkPayload): Promise<HostSuccess> => {
    const active = getActiveRuntime();
    const base = currentBaseline();
    if (!active || !base) return { success: false, error: baselineFailure ?? 'not-started' };
    if (!payload.patch.trim()) return { success: false, error: 'empty patch' };
    try {
      if ((await conflictPaths(active.cwd, base)).has(payload.path)) {
        return { success: false, error: 'conflicted files cannot be reverted from Review' };
      }
      const apply = await runGit(active.cwd, ['apply', '-R'], { env: base.gitEnv, input: payload.patch });
      if (apply.code !== 0) return { success: false, error: apply.stderr.trim() || 'git apply failed' };
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
