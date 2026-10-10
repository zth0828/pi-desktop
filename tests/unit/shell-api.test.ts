import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn(async () => ({
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,mock',
    })),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  },
}));

import { isRelevantApplication, shellApi } from '../../electron/services/shell-api';

describe('shell-api', () => {
  it('识别主流开发工具与编辑器进程名', () => {
    expect(isRelevantApplication('Code')).toBe(true);
    expect(isRelevantApplication('Visual Studio Code')).toBe(true);
    expect(isRelevantApplication('Cursor')).toBe(true);
    expect(isRelevantApplication('Windsurf')).toBe(true);
    expect(isRelevantApplication('sublime_text')).toBe(true);
    expect(isRelevantApplication('idea64')).toBe(false);
    expect(isRelevantApplication('calc')).toBe(false);
  });

  it('openPath 对不存在的文件返回 file-not-found', async () => {
    const res = await shellApi.openPath({ path: '/non/existent/path/xyz.txt' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('file-not-found');
  });

  it('openPath, openPathWith 与 showInFolder 拦截空路径与 Windows 设备路径', async () => {
    expect(await shellApi.openPath({ path: '' })).toEqual({ success: false, error: 'invalid-path' });
    expect(await shellApi.openPath({ path: '   ' })).toEqual({ success: false, error: 'invalid-path' });
    expect(await shellApi.openPath({ path: 'CON' })).toEqual({ success: false, error: 'device paths are not allowed' });

    expect(await shellApi.openPathWith({ path: '', application: { id: 'app', name: 'Code', path: '/bin/code' } })).toEqual({ success: false, error: 'invalid-path' });
    expect(await shellApi.openPathWith({ path: 'CON', application: { id: 'app', name: 'Code', path: '/bin/code' } })).toEqual({ success: false, error: 'device paths are not allowed' });

    expect(await shellApi.showInFolder({ path: '' })).toEqual({ success: false, error: 'invalid-path' });
    expect(await shellApi.showInFolder({ path: 'CON' })).toEqual({ success: false, error: 'device paths are not allowed' });
  });

  it('openPathWith 对不存在的文件返回 file-not-found', async () => {
    const res = await shellApi.openPathWith({
      path: '/non/existent/path/xyz.txt',
      application: { id: 'app', name: 'Code', path: '/bin/code' },
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('file-not-found');
  });

  it('openPathWith 对存在的文件启动应用程序并容忍子进程启动异常', async () => {
    const res = await shellApi.openPathWith({
      path: __filename,
      application: { id: 'app', name: 'NonExistent', path: '/non/existent/bin/code.cmd' },
    });
    expect(res.success).toBe(true);
  });

  it('openPath 与 showInFolder 剥离 Windows 扩展前缀 (\\\\?\\)', async () => {
    const { shell } = await import('electron');
    const prefixed = `\\\\?\\${__filename}`;
    const openRes = await shellApi.openPath({ path: prefixed });
    expect(openRes.success).toBe(true);
    expect(shell.openPath).toHaveBeenCalledWith(__filename);

    const showRes = await shellApi.showInFolder({ path: prefixed });
    expect(showRes.success).toBe(true);
    expect(shell.showItemInFolder).toHaveBeenCalledWith(__filename);
  });

  it('openExternal 只放行 http/https/mailto 安全协议并拦截其他危险协议', async () => {
    const { shell } = await import('electron');
    vi.mocked(shell.openExternal).mockClear();

    await shellApi.openExternal({ url: 'https://github.com' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com');

    vi.mocked(shell.openExternal).mockClear();
    await shellApi.openExternal({ url: 'http://localhost:3000' });
    expect(shell.openExternal).toHaveBeenCalledWith('http://localhost:3000');

    vi.mocked(shell.openExternal).mockClear();
    await shellApi.openExternal({ url: 'file:///etc/passwd' });
    expect(shell.openExternal).not.toHaveBeenCalled();

    await shellApi.openExternal({ url: 'javascript:alert(1)' });
    expect(shell.openExternal).not.toHaveBeenCalled();

    await shellApi.openExternal({ url: 'ms-msdt:/id' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

