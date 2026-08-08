import { describe, expect, it } from 'vitest';
import { shouldNotify } from '@electron/services/notify-policy';

describe('notify-policy 档位判定', () => {
  it('off：任何焦点状态都不通知', () => {
    expect(shouldNotify('off', true)).toBe(false);
    expect(shouldNotify('off', false)).toBe(false);
  });

  it('always：任何焦点状态都通知', () => {
    expect(shouldNotify('always', true)).toBe(true);
    expect(shouldNotify('always', false)).toBe(true);
  });

  it('unfocused：仅窗口失焦时通知', () => {
    expect(shouldNotify('unfocused', true)).toBe(false);
    expect(shouldNotify('unfocused', false)).toBe(true);
  });

  it('未设置（undefined）等同 unfocused', () => {
    expect(shouldNotify(undefined, true)).toBe(false);
    expect(shouldNotify(undefined, false)).toBe(true);
  });
});
