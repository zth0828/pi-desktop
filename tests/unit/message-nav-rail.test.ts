import { describe, expect, it } from 'vitest';
import { truncateRailText } from '../../src/lib/nav-rail';

describe('truncateRailText', () => {
  it('短文本不截断且不加省略号', () => {
    expect(truncateRailText('Hello world')).toBe('Hello world');
    expect(truncateRailText('这是一个简短的问题')).toBe('这是一个简短的问题');
  });

  it('刚好 120 字符不截断', () => {
    const text = 'a'.repeat(120);
    expect(truncateRailText(text)).toBe(text);
  });

  it('超过 120 字符截断并追加省略号', () => {
    const longText = 'a'.repeat(200);
    const truncated = truncateRailText(longText);
    expect(truncated).toBe(`${'a'.repeat(120)}…`);
    expect(Array.from(truncated)).toHaveLength(121);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('中文等多字节 Unicode 字符按字符数正确截断', () => {
    const chineseText = '你'.repeat(150);
    const truncated = truncateRailText(chineseText);
    expect(truncated).toBe(`${'你'.repeat(120)}…`);
    expect(Array.from(truncated)).toHaveLength(121);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('空文本保持为空', () => {
    expect(truncateRailText('')).toBe('');
  });

  it('支持自定义最大长度', () => {
    expect(truncateRailText('abcdef', 3)).toBe('abc…');
  });
});
