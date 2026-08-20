// git-api：当前工作区分支检测（与 pi TUI footer 同口径）。
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getGitBranch } from '@electron/services/git-api';

let dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-desktop-git-test-'));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 造一个普通 git 仓库（.git 为目录，HEAD 指向 refs/heads/<branch>）。 */
async function makeGitRepo(branch: string): Promise<string> {
  const dir = await makeDir();
  await mkdir(join(dir, '.git', 'refs', 'heads'), { recursive: true });
  await writeFile(join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  return dir;
}

/** 造一个 worktree（.git 为 gitdir 文件，真实 git 的 worktree 布局）。 */
async function makeWorktree(branch: string): Promise<string> {
  const dir = await makeDir();
  const gitDir = join(dir, '.worktree-git');
  await mkdir(join(gitDir, 'refs', 'heads'), { recursive: true });
  await writeFile(join(gitDir, 'HEAD'), `ref: refs/heads/${branch}\n`);
  await writeFile(join(dir, '.git'), `gitdir: ${gitDir}\n`);
  return dir;
}

describe('getGitBranch', () => {
  test('非 git 目录返回 null', async () => {
    const dir = await makeDir();
    const result = await getGitBranch(dir);
    expect(result.branch).toBeNull();
  });

  test('普通仓库读 HEAD 得到分支名', async () => {
    const dir = await makeGitRepo('win-compat');
    const result = await getGitBranch(dir);
    expect(result.branch).toBe('win-compat');
  });

  test('子目录向上找到仓库根', async () => {
    const repo = await makeGitRepo('main');
    const nested = join(repo, 'src', 'deep');
    await mkdir(nested, { recursive: true });
    const result = await getGitBranch(nested);
    expect(result.branch).toBe('main');
  });

  test('detached HEAD 返回 detached', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, '.git', 'HEAD'), '8f5c2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f\n');
    const result = await getGitBranch(dir);
    expect(result.branch).toBe('detached');
  });

  test('worktree（.git 为文件）同样识别', async () => {
    const dir = await makeWorktree('feature/x');
    const result = await getGitBranch(dir);
    expect(result.branch).toBe('feature/x');
  });

  test('.git 不存在 HEAD 时返回 null（坏仓库不抛错）', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, '.git'), { recursive: true });
    const result = await getGitBranch(dir);
    expect(result.branch).toBeNull();
  });
});
