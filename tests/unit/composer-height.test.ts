import { describe, expect, it } from 'vitest';
import { computeComposerHeight } from '../../src/pages/Chat/chat-input/composer-height';

describe('computeComposerHeight (输入框高度自适应纯计算函数)', () => {
  it('内容为空时重置内联高度为空字符串，使 CSS 原生 min-height 生效', () => {
    const res = computeComposerHeight(false, 180, 900);
    expect(res.heightStyle).toBe('');
    expect(res.scrollable).toBe(false);
  });

  it('单行或内容较少时保持 56px 默认底高', () => {
    const res = computeComposerHeight(true, 38, 900);
    expect(res.heightStyle).toBe('56px');
    expect(res.scrollable).toBe(false);
  });

  it('多行内容随 scrollHeight 正常扩展', () => {
    const res = computeComposerHeight(true, 140, 900);
    expect(res.heightStyle).toBe('140px');
    expect(res.scrollable).toBe(false);
  });

  it('超长内容限制在 maximum 并启用滚动条', () => {
    // 视口高度 900 * 0.32 = 288，被上限 260 截断
    const res = computeComposerHeight(true, 400, 900);
    expect(res.heightStyle).toBe('260px');
    expect(res.scrollable).toBe(true);
  });

  it('视口较小时按 32vh 动态限制最大高度，下限不少于 112px', () => {
    // 视口高度 300 * 0.32 = 96，但下限为 112
    const res = computeComposerHeight(true, 300, 300);
    expect(res.heightStyle).toBe('112px');
    expect(res.scrollable).toBe(true);
  });
});
