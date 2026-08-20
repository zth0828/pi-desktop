// gitBranch：当前工作区 git 分支读取（与 pi TUI footer 同口径）。
// pi 的 FooterDataProvider 按 cwd 向上找 .git（支持 worktree：.git 为文件时读 gitdir），
// 读 HEAD（ref: refs/heads/<branch> → branch；detached HEAD → "detached"），
// git 不可用/非仓库返回 null。壳在 main 侧用同一逻辑实现，供输入栏展示当前分支。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type GitBranchResult = {
  /** 当前分支名；detached HEAD 为 'detached'；非 git 仓库 / git 不可用为 null。 */
  branch: string | null;
};

type GitPaths = { repoDir: string; headPath: string };

/** 从 cwd 向上找 .git（目录或 worktree 的 gitdir 文件）。 */
function findGitPaths(cwd: string): GitPaths | null {
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

export const gitApi = {
  getBranch: (payload: { cwd: string }): Promise<GitBranchResult> => getGitBranch(payload.cwd),
};
