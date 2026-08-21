import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutGitBranch, getGitBranch, listGitBranches } from '../../electron/services/git-api';

describe('git-api', () => {
  let repoDir: string;
  let nonGitDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), 'pi-git-test-repo-'));
    nonGitDir = await mkdtemp(path.join(tmpdir(), 'pi-git-test-nongit-'));

    // 初始化测试 git 仓库
    execSync('git init -b main', { cwd: repoDir });
    execSync('git config user.name "Test User"', { cwd: repoDir });
    execSync('git config user.email "test@example.com"', { cwd: repoDir });
    await writeFile(path.join(repoDir, 'README.md'), '# Initial');
    execSync('git add README.md && git commit -m "init"', { cwd: repoDir });
    execSync('git branch feature-test', { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(nonGitDir, { recursive: true, force: true });
  });

  it('非 git 目录返回空分支与 null', async () => {
    const branchRes = await getGitBranch(nonGitDir);
    expect(branchRes.branch).toBeNull();

    const listRes = await listGitBranches(nonGitDir);
    expect(listRes.branches).toEqual([]);
    expect(listRes.current).toBeNull();
    expect(listRes.isDirty).toBe(false);

    const checkoutRes = await checkoutGitBranch(nonGitDir, 'main');
    expect(checkoutRes.success).toBe(false);
    expect(checkoutRes.error).toBe('not a git repository');
  });

  it('正确列出本地分支与当前分支', async () => {
    const branchRes = await getGitBranch(repoDir);
    expect(branchRes.branch).toBe('main');

    const listRes = await listGitBranches(repoDir);
    expect(listRes.current).toBe('main');
    expect(listRes.branches).toContain('main');
    expect(listRes.branches).toContain('feature-test');
    expect(listRes.isDirty).toBe(false);
  });

  it('检测工作区未提交改动（dirty）', async () => {
    await writeFile(path.join(repoDir, 'newfile.txt'), 'dirty content');
    const listRes = await listGitBranches(repoDir);
    expect(listRes.isDirty).toBe(true);

    const checkoutRes = await checkoutGitBranch(repoDir, 'feature-test');
    expect(checkoutRes.success).toBe(false);
    expect(checkoutRes.error).toBe('dirty');
  });

  it('干净工作区成功切换分支', async () => {
    const checkoutRes = await checkoutGitBranch(repoDir, 'feature-test');
    expect(checkoutRes.success).toBe(true);
    expect(checkoutRes.branch).toBe('feature-test');

    const branchRes = await getGitBranch(repoDir);
    expect(branchRes.branch).toBe('feature-test');
  });
});
