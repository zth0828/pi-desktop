import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWindowsDevicePath, resolveWorkspacePath } from '../../electron/utils/workspace-path';
import { workspaceApi } from '../../electron/services/workspace-api';
import { resolveRuntimeForContext } from '../../electron/services/pi-runtime-api';

vi.mock('../../electron/services/pi-runtime-api', () => ({
  resolveRuntimeForContext: vi.fn(),
}));

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
    await expect(resolveWorkspacePath(root, 'C:secret')).rejects.toThrow('absolute paths are not allowed');
    await expect(resolveWorkspacePath(root, 'C:/secret')).rejects.toThrow('absolute paths are not allowed');
    await expect(resolveWorkspacePath(root, 'D:\\secret')).rejects.toThrow('absolute paths are not allowed');
  });

  it('rejects symlinks whose targets escape the workspace', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    await expect(resolveWorkspacePath(root, 'link.txt')).rejects.toThrow('escapes workspace');
  });

  it('rejects Windows device and DOS reserved paths', async () => {
    await expect(resolveWorkspacePath(root, 'CON')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, 'NUL')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, 'COM1')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, 'sub/CON')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, 'dir/aux.txt')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, '\\\\.\\pipe\\foo')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, '//./pipe/foo')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, '//?/C:/secret')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, '\\??\\C:\\secret')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, '//??/C:/secret')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, 'CONIN$')).rejects.toThrow('device paths are not allowed');
    await expect(resolveWorkspacePath(root, 'CONOUT$')).rejects.toThrow('device paths are not allowed');
  });

  it('对空串、非字符串或 undefined 安全返回 false 而不抛错', () => {
    expect(isWindowsDevicePath('')).toBe(false);
    expect(isWindowsDevicePath(undefined as unknown as string)).toBe(false);
    expect(isWindowsDevicePath(null as unknown as string)).toBe(false);
    expect(isWindowsDevicePath(123 as unknown as string)).toBe(false);
  });
});

describe('workspaceApi.readFile', () => {
  let parent: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'pi-desktop-ws-read-'));
    root = path.join(parent, 'root');
    outside = path.join(parent, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(root, 'inside.txt'), 'hello inside');
    await writeFile(path.join(outside, 'secret.txt'), 'secret outside');
    vi.mocked(resolveRuntimeForContext).mockReturnValue({
      cwd: root,
      previewableExternalFiles: new Set<string>(),
    } as any);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(parent, { recursive: true, force: true });
  });

  it('允许使用工作区内文件的绝对路径进行预览读取', async () => {
    const insideAbs = path.join(root, 'inside.txt');
    const result = await workspaceApi.readFile({ path: insideAbs });
    expect(result.text).toBe('hello inside');
    expect(result.name).toBe('inside.txt');
  });

  it('拦截工作区外的未授权绝对路径', async () => {
    const outsideAbs = path.join(outside, 'secret.txt');
    await expect(workspaceApi.readFile({ path: outsideAbs })).rejects.toThrow(
      'file is outside the active workspace and was not produced by this session',
    );
  });

  it('对空路径或非字符串路径抛出 empty path 错误', async () => {
    // @ts-expect-error testing invalid payload
    await expect(workspaceApi.readFile({})).rejects.toThrow('empty path');
    await expect(workspaceApi.readFile({ path: '' })).rejects.toThrow('empty path');
    await expect(workspaceApi.readFile({ path: '   ' })).rejects.toThrow('empty path');
    // @ts-expect-error testing null path
    await expect(workspaceApi.readFile({ path: null })).rejects.toThrow('empty path');
  });

  it('listChildren 在 payload 为空时默认列出根目录', async () => {
    // @ts-expect-error testing undefined payload
    const res = await workspaceApi.listChildren(undefined);
    expect(res.entries.some((e) => e.name === 'inside.txt')).toBe(true);
  });
});

