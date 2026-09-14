import { describe, expect, it } from 'vitest';
import { cleanOptionText } from '../../src/components/extension-ui-clean';

describe('extension-ui-clean (选项文本前缀清洗)', () => {
  it('清洗选项开头常见的阿拉伯数字与各种标点前缀', () => {
    expect(cleanOptionText('1. Provider 认证状态汇总')).toBe('Provider 认证状态汇总');
    expect(cleanOptionText('2、应用级用户账号')).toBe('应用级用户账号');
    expect(cleanOptionText('3) OAuth 会话生命周期')).toBe('OAuth 会话生命周期');
    expect(cleanOptionText('4）多用户/多 profile')).toBe('多用户/多 profile');
    expect(cleanOptionText('5. Other (free-form)')).toBe('Other (free-form)');
  });

  it('无数字前缀的选项文本保持原样', () => {
    expect(cleanOptionText('直接覆盖现有实现')).toBe('直接覆盖现有实现');
    expect(cleanOptionText('Fast in-memory storage')).toBe('Fast in-memory storage');
    expect(cleanOptionText('')).toBe('');
  });
});
