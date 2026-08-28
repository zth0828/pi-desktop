// @ 文件补全模糊匹配单测：子串/子序列打分排序。
import { describe, expect, it } from 'vitest';
import { filterFiles } from '../../src/lib/file-search';

const FILES = [
  'src/pages/Chat/ChatInput.tsx',
  'src/lib/host-api.ts',
  'README.md',
  'docs/chat-notes.md',
  'package.json',
];

describe('filterFiles', () => {
  it('空 query 返回前 limit 条（字典序）', () => {
    const result = filterFiles(['b.ts', 'a.ts', 'c.ts'], '', 2);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  it('文件名前缀命中排最前', () => {
    const result = filterFiles(FILES, 'chat');
    expect(result[0]).toBe('docs/chat-notes.md'); // 文件名 chat-notes.md 前缀命中
    expect(result).toContain('src/pages/Chat/ChatInput.tsx');
  });

  it('子串命中排在子序列前', () => {
    // 'ab' 是 xoab.ts 的子串；对 sub.ts 只是子序列（a…b 中间隔着 u 后的 b? 见下）
    const result = filterFiles(['xoab.ts', 'sa-b.ts', 'zzz.ts'], 'ab');
    expect(result[0]).toBe('xoab.ts');
    expect(result).not.toContain('zzz.ts');
  });

  it('子序列匹配兜底', () => {
    const result = filterFiles(['src/pages/Chat/ChatInput.tsx'], 'cinp');
    expect(result).toEqual(['src/pages/Chat/ChatInput.tsx']);
  });

  it('不匹配返回空', () => {
    expect(filterFiles(FILES, 'zzzz')).toEqual([]);
  });

  it('大小写不敏感', () => {
    expect(filterFiles(['README.md'], 'readme')).toEqual(['README.md']);
  });
});

import { getVisibleTreeItems } from '../../src/pages/Chat/chat-input/useFileMentions';
import { detectAtToken } from '../../src/pages/Chat/chat-input/types';

describe('getVisibleTreeItems', () => {
  it('返回根目录与根文件的拍平树结构', () => {
    const dirTree = {
      dir: '',
      dirs: ['docs', 'src'],
      files: ['package.json', 'README.md'],
    };
    const items = getVisibleTreeItems(dirTree, {}, new Set());
    expect(items).toEqual([
      { kind: 'dir', name: 'docs', full: 'docs', parent: '', depth: 0, open: false },
      { kind: 'dir', name: 'src', full: 'src', parent: '', depth: 0, open: false },
      { kind: 'file', name: 'package.json', full: 'package.json', depth: 0 },
      { kind: 'file', name: 'README.md', full: 'README.md', depth: 0 },
    ]);
  });

  it('展开子目录后包含子目录及子文件，并正确计算深度', () => {
    const dirTree = {
      dir: '',
      dirs: ['src'],
      files: ['package.json'],
    };
    const dirContents = {
      src: {
        dirs: ['components'],
        files: ['App.tsx', 'main.ts'],
      },
      'src/components': {
        dirs: [],
        files: ['Button.tsx'],
      },
    };
    const expandedDirs = new Set(['src', 'src/components']);
    const items = getVisibleTreeItems(dirTree, dirContents, expandedDirs);

    expect(items).toEqual([
      { kind: 'dir', name: 'src', full: 'src', parent: '', depth: 0, open: true },
      { kind: 'dir', name: 'components', full: 'src/components', parent: 'src', depth: 1, open: true },
      { kind: 'file', name: 'Button.tsx', full: 'src/components/Button.tsx', depth: 2 },
      { kind: 'file', name: 'App.tsx', full: 'src/App.tsx', depth: 1 },
      { kind: 'file', name: 'main.ts', full: 'src/main.ts', depth: 1 },
      { kind: 'file', name: 'package.json', full: 'package.json', depth: 0 },
    ]);
  });

  it('空 dirTree 返回空数组', () => {
    expect(getVisibleTreeItems(null, {}, new Set())).toEqual([]);
  });
});

describe('detectAtToken', () => {
  it('检测行首的 @', () => {
    expect(detectAtToken('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(detectAtToken('@src', 4)).toEqual({ start: 0, end: 4, query: 'src' });
  });

  it('检测空格后的 @', () => {
    expect(detectAtToken('hello @', 7)).toEqual({ start: 6, end: 7, query: '' });
    expect(detectAtToken('hello @app', 10)).toEqual({ start: 6, end: 10, query: 'app' });
  });

  it('非有效边界不识别为 token（如 email）', () => {
    expect(detectAtToken('abc@def.com', 4)).toBeNull();
  });
});
