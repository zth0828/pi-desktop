import { describe, expect, it } from 'vitest';
import { sessionTitleFromQuestion } from '../../src/lib/session-title';

describe('sessionTitleFromQuestion', () => {
  it('折叠空白并保留首问语义', () => {
    expect(sessionTitleFromQuestion('  分析\n当前项目  ', '图片会话')).toBe('分析 当前项目');
  });

  it('按 Unicode 字符截断长标题', () => {
    const title = sessionTitleFromQuestion('你'.repeat(140), '图片会话');
    expect(Array.from(title)).toHaveLength(121);
    expect(title.endsWith('…')).toBe(true);
  });

  it('纯附件首问使用本地化回退名', () => {
    expect(sessionTitleFromQuestion('', 'Image conversation')).toBe('Image conversation');
  });

  it('剥离附件信封（标题栏 fallback 直接吃首条消息原文）', () => {
    const raw = '<attachments>\n<attachment index="1" kind="image" name="image.png" image-index="1"></attachment>\n</attachments>\n你看看这个问题';
    expect(sessionTitleFromQuestion(raw, '图片会话')).toBe('你看看这个问题');
    expect(sessionTitleFromQuestion('<attachments>\n<attachment index="1" kind="image" name="a.png"></attachment>\n</attachments>', '图片会话')).toBe('图片会话');
  });
});
