// gitBranch：当前工作区 git 分支读取与切换。
// pi 的 FooterDataProvider 按 cwd 向上找 .git（支持 worktree：.git 为文件时读 gitdir），
// 读 HEAD（ref: refs/heads/<branch> → branch；detached HEAD → "detached"），
// git 不可用/非仓库返回 null。壳在 main 侧提供分支展示、列表与切换能力。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { GitBranchListResult, GitBranchResult, GitCheckoutResult } from '@shared/host-api/contract';
import { isCwdRunning } from './pi-runtime-api';

type GitPaths = { repoDir: string; headPath: string };

/** 从 cwd 向上找 .git（目录或 worktree 的 gitdir 文件）。 */
export function findGitPaths(cwd: string): GitPaths | null {
  let dir = cwd;
  for (;;) {
    const gitPath = join(dir, '.git');
    if (existsSync(gitPath)) {
      try {
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          const content = readFileSync(gitPath, 'utf8').trim();
          if (content.startsWith('gitdir: ')) {
            const gitDir = resolve(dir, content.slice(8).trim());
            const headPath = join(gitDir, 'HEAD');
            if (!existsSync(headPath)) return null;
            return { repoDir: dir, headPath };
          }
        } else if (stat.isDirectory()) {
          const headPath = join(gitPath, 'HEAD');
          if (!existsSync(headPath)) return null;
          return { repoDir: dir, headPath };
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function execGit(repoDir: string, args: string[], timeout = 5000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      {
        cwd: repoDir,
        encoding: 'utf8',
        timeout,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(Object.assign(error, { stdout: stdout?.trim() ?? '', stderr: stderr?.trim() ?? '' }));
        } else {
          resolvePromise({ stdout: stdout?.trim() ?? '', stderr: stderr?.trim() ?? '' });
        }
      },
    );
  });
}

/** 异步读取当前分支（与 pi FooterDataProvider 的异步路径一致，避免阻塞 main）。 */
export function getGitBranch(cwd: string): Promise<GitBranchResult> {
  return new Promise((resolvePromise) => {
    const gitPaths = findGitPaths(cwd);
    if (!gitPaths) {
      resolvePromise({ branch: null });
      return;
    }
    // HEAD 是普通 ref 时直接读文件即得，不必起 git 进程
    try {
      const content = readFileSync(gitPaths.headPath, 'utf8').trim();
      if (content.startsWith('ref: refs/heads/')) {
        const branch = content.slice(16);
        resolvePromise({ branch: branch && branch !== '.invalid' ? branch : 'detached' });
        return;
      }
      if (!content.startsWith('ref:')) {
        resolvePromise({ branch: 'detached' });
        return;
      }
    } catch {
      resolvePromise({ branch: null });
      return;
    }
    execFile('git', ['--no-optional-locks', 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: gitPaths.repoDir,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        resolvePromise({ branch: 'detached' });
        return;
      }
      const branch = stdout.trim();
      resolvePromise({ branch: branch || 'detached' });
    });
  });
}

/** 列出本地分支以及工作区是否有未提交改动。 */
export async function listGitBranches(cwd: string): Promise<GitBranchListResult> {
  const gitPaths = findGitPaths(cwd);
  if (!gitPaths) {
    return { branches: [], current: null, isDirty: false };
  }
  try {
    const [branchOutput, statusOutput, currentResult] = await Promise.all([
      execGit(gitPaths.repoDir, ['branch', '--list', '--format=%(refname:short)']),
      execGit(gitPaths.repoDir, ['status', '--porcelain']),
      getGitBranch(cwd),
    ]);
    const branches = branchOutput.stdout
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);
    const isDirty = statusOutput.stdout.length > 0;
    return {
      branches,
      current: currentResult.branch,
      isDirty,
    };
  } catch {
    return { branches: [], current: null, isDirty: false };
  }
}

/** 切换本地分支（带运行中状态检查与 dirty 预检）。 */
export async function checkoutGitBranch(
  cwd: string,
  branch: string,
): Promise<GitCheckoutResult> {
  if (isCwdRunning(cwd)) {
    return { success: false, error: 'running' };
  }
  const gitPaths = findGitPaths(cwd);
  if (!gitPaths) {
    return { success: false, error: 'not a git repository' };
  }
  try {
    const status = await execGit(gitPaths.repoDir, ['status', '--porcelain']);
    if (status.stdout.length > 0) {
      return { success: false, error: 'dirty' };
    }
    try {
      await execGit(gitPaths.repoDir, ['switch', branch]);
    } catch {
      await execGit(gitPaths.repoDir, ['checkout', branch]);
    }
    return { success: true, branch };
  } catch (err: unknown) {
    const gitErr = err as { stderr?: string; message?: string };
    const errorMsg = gitErr.stderr || gitErr.message || 'checkout failed';
    return { success: false, error: errorMsg };
  }
}

export const gitApi = {
  getBranch: (payload: { cwd: string }): Promise<GitBranchResult> => getGitBranch(payload.cwd),
  listBranches: (payload: { cwd: string }): Promise<GitBranchListResult> => listGitBranches(payload.cwd),
  checkout: (payload: { cwd: string; branch: string }): Promise<GitCheckoutResult> =>
    checkoutGitBranch(payload.cwd, payload.branch),
};
