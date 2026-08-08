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
