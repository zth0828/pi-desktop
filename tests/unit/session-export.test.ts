import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  projectFolderName,
  sanitizePathSegment,
  sessionExportDirectory,
  sessionExportPath,
  sessionExportRootDirectory,
} from '../../electron/utils/session-export';

// Mock electron app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'documents' ? '/mock/Documents' : '/mock'),
  },
}));

// Mock mkdir so sessionExportPath does not try to create real folders in unit test
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('session-export utilities', () => {
  describe('sanitizePathSegment', () => {
    it('过滤特殊非法字符与控制字符', () => {
      expect(sanitizePathSegment('hello/world:test*?')).toBe('hello_world_test__');
      expect(sanitizePathSegment('  foo  bar  ')).toBe('foo bar');
      expect(sanitizePathSegment('trailing. ')).toBe('trailing');
    });

    it('为空时返回 fallback', () => {
      expect(sanitizePathSegment('   ', 'fallback-name')).toBe('fallback-name');
    });

    it('对 Windows 保留设备名称（CON, PRN, AUX, NUL, CONIN$, CONOUT$ 等）添加后缀规避冲突', () => {
      expect(sanitizePathSegment('CON')).toBe('CON_');
      expect(sanitizePathSegment('aux')).toBe('aux_');
      expect(sanitizePathSegment('NUL')).toBe('NUL_');
      expect(sanitizePathSegment('com1')).toBe('com1_');
      expect(sanitizePathSegment('CONIN$')).toBe('CONIN$_');
      expect(sanitizePathSegment('conout$')).toBe('conout$_');
      expect(sanitizePathSegment('CON.txt')).toBe('CON.txt_');
      expect(sanitizePathSegment('aux.log')).toBe('aux.log_');
    });

    it('对非字符串输入安全返回 fallback', () => {
      // @ts-expect-error testing undefined input
      expect(sanitizePathSegment(undefined)).toBe('default');
      // @ts-expect-error testing null input
      expect(sanitizePathSegment(null, 'custom')).toBe('custom');
      // @ts-expect-error testing number input
      expect(sanitizePathSegment(123 as unknown as string, 'num')).toBe('num');
    });
  });

  describe('projectFolderName', () => {
    it('从 Unix 路径提取项目名', () => {
      expect(projectFolderName('/Users/bingking/Desktop/天高/医光年/二期')).toBe('二期');
      expect(projectFolderName('/Users/bingking/Desktop/pi-desktop')).toBe('pi-desktop');
    });

    it('从 Windows 路径提取项目名', () => {
      expect(projectFolderName('C:\\Users\\bingking\\Projects\\my-project')).toBe('my-project');
    });

    it('缺省 cwd 或非字符串返回 default', () => {
      expect(projectFolderName(undefined)).toBe('default');
      expect(projectFolderName('')).toBe('default');
      // @ts-expect-error testing non-string cwd
      expect(projectFolderName(123 as unknown as string)).toBe('default');
    });
  });

  describe('sessionExportDirectory', () => {
    it('根目录包含 Documents/Pi Desktop/Exports', () => {
      const root = sessionExportRootDirectory();
      expect(root).toBe(path.join('/mock/Documents', 'Pi Desktop', 'Exports'));
    });

    it('带 cwd 时按项目名归类到子目录', () => {
      const dir = sessionExportDirectory('/Users/bingking/Desktop/天高/医光年/二期');
      expect(dir).toBe(path.join('/mock/Documents', 'Pi Desktop', 'Exports', '二期'));
    });

    it('不带 cwd 时返回根目录', () => {
      const dir = sessionExportDirectory();
      expect(dir).toBe(sessionExportRootDirectory());
    });
  });

  describe('sessionExportPath', () => {
    const mockSessionFile = '/Users/test/.pi/agent/sessions/--test--/2026-08-22T20-44-15-718Z_01a02b37-8be6-71c8-9f73-72160c75bd76.jsonl';

    it('根据会话标题、项目名、日期与短 ID 生成可读路径', async () => {
      const exportPath = await sessionExportPath({
        sessionFile: mockSessionFile,
        cwd: '/Users/bingking/Desktop/天高/医光年/二期',
        title: '帮我看看这个html页面 我想要调整一下这个',
        id: '01a02b37-8be6-71c8-9f73-72160c75bd76',
      });

      expect(exportPath).toBe(
        path.join(
          '/mock/Documents',
          'Pi Desktop',
          'Exports',
          '二期',
          '帮我看看这个html页面 我想要调整一下这个_2026-08-22_01a02b37.html',
        ),
      );
    });

    it('标题含特殊字符与过长字符时安全过滤并截断', async () => {
      const exportPath = await sessionExportPath({
        sessionFile: mockSessionFile,
        cwd: '/Users/bingking/Desktop/pi-desktop',
        title: '分析当前项目当前版本代码跟 远程main分支代码的区别 然后 写好release notes 包含所有重要提交与改动详情',
      });

      const fileName = path.basename(exportPath);
      expect(fileName).toMatch(/_2026-08-22_01a02b37\.html$/);
      expect(fileName.length).toBeLessThan(100);
      expect(exportPath).toContain(path.join('Exports', 'pi-desktop'));
    });

    it('无标题时 fallback 到 pi-session-日期_短ID.html', async () => {
      const exportPath = await sessionExportPath({
        sessionFile: mockSessionFile,
        cwd: '/Users/bingking/Desktop/pi-desktop',
      });

      expect(path.basename(exportPath)).toBe('pi-session-2026-08-22_01a02b37.html');
    });
  });
});
