// samePath / pathsEqual（electron/utils/same-path.ts）：
// - posix：symlink 形式差异经 realpath 拉齐（macOS /tmp → /private/tmp）
// - win32：大小写不敏感、/ 与 \ 混用归一（NTFS 语义，mac 上注入 platform 参数验证）
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathsEqual, samePath } from '../../electron/utils/same-path';

describe('pathsEqual', () => {
  it('identical strings match on any platform', () => {
    expect(pathsEqual('/a/b', '/a/b', 'darwin')).toBe(true);
    expect(pathsEqual('C:\\A\\B', 'C:\\A\\B', 'win32')).toBe(true);
  });

  it('posix: case-sensitive, dot segments normalized', () => {
    expect(pathsEqual('/a/b', '/A/b', 'darwin')).toBe(false);
    expect(pathsEqual('/a/./b', '/a/b', 'linux')).toBe(true);
  });

  it('win32: case-insensitive and separator-agnostic', () => {
    expect(pathsEqual('C:\\Users\\X\\file.json', 'c:\\users\\x\\FILE.json', 'win32')).toBe(true);
    expect(pathsEqual('C:/Users/X/file.json', 'c:\\users\\x\\file.json', 'win32')).toBe(true);
    expect(pathsEqual('C:\\a\\b', 'C:\\a\\c', 'win32')).toBe(false);
    // posix 语义下同样的大小写差异不得判等（mac 行为不变）
    expect(pathsEqual('C:\\Users\\X\\file.json', 'c:\\users\\x\\FILE.json', 'darwin')).toBe(false);
  });
});

describe('samePath', () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'pi-desktop-same-path-'));
  });

  afterEach(async () => { await rm(parent, { recursive: true, force: true }); });

  it('matches symlinked forms via realpath', async () => {
    const target = path.join(parent, 'real.txt');
    const link = path.join(parent, 'link.txt');
    await writeFile(target, 'x');
    await symlink(target, link);
    expect(samePath(link, target)).toBe(true);
    expect(samePath(link, await realpath(target))).toBe(true);
  });

  it('returns false for different or missing paths', async () => {
    const a = path.join(parent, 'a.txt');
    await writeFile(a, 'x');
    expect(samePath(a, path.join(parent, 'b.txt'))).toBe(false);
    expect(samePath(undefined, a)).toBe(false);
    expect(samePath(a, '')).toBe(false);
  });
});
