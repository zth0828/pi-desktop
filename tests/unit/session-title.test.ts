import { describe, expect, it } from 'vitest';
import { sessionTitleFromQuestion } from '../../src/lib/session-title';

describe('sessionTitleFromQuestion', () => {
  it('折叠空白并保留首问语义', () => {
    expect(sessionTitleFromQuestion('  分析\n当前项目  ', '图片会话')).toBe('分析 当前项目');
  });

  it('按 Unicode 字符截断长标题', () => {
    const title = sessionTitleFromQuestion('你'.repeat(50), '图片会话');
    expect(Array.from(title)).toHaveLength(43);
    expect(title.endsWith('…')).toBe(true);
  });

  it('纯附件首问使用本地化回退名', () => {
    expect(sessionTitleFromQuestion('', 'Image conversation')).toBe('Image conversation');
  });
});
