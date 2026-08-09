import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWorkspacePath } from '../../electron/utils/workspace-path';

describe('resolveWorkspacePath', () => {
  let parent: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'pi-desktop-workspace-'));
    root = path.join(parent, 'root');
    outside = path.join(parent, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(root, 'inside.txt'), 'inside');
    await writeFile(path.join(outside, 'secret.txt'), 'outside');
  });

  afterEach(async () => { await rm(parent, { recursive: true, force: true }); });

  it('resolves files inside the workspace', async () => {
    await expect(resolveWorkspacePath(root, 'inside.txt')).resolves.toBe(await realpath(path.join(root, 'inside.txt')));
  });

  it('rejects lexical and absolute escapes', async () => {
    await expect(resolveWorkspacePath(root, '../outside/secret.txt')).rejects.toThrow('escapes workspace');
    await expect(resolveWorkspacePath(root, path.join(outside, 'secret.txt'))).rejects.toThrow('absolute');
  });

  it('rejects symlinks whose targets escape the workspace', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    await expect(resolveWorkspacePath(root, 'link.txt')).rejects.toThrow('escapes workspace');
  });
});
