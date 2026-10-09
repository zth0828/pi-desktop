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

  it('openPathWith 对不存在的文件返回 file-not-found', async () => {
    const res = await shellApi.openPathWith({
      path: '/non/existent/path/xyz.txt',
      application: { id: 'app', name: 'Code', path: '/bin/code' },
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('file-not-found');
  });
});
