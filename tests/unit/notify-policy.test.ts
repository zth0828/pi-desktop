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

describe('notifyUiRequest 分类开关', () => {
  it('uiRequest + 开关关闭：任何档位/焦点都不通知', () => {
    expect(shouldNotify('always', false, 'uiRequest', false)).toBe(false);
    expect(shouldNotify('always', true, 'uiRequest', false)).toBe(false);
    expect(shouldNotify('unfocused', false, 'uiRequest', false)).toBe(false);
  });

  it('uiRequest + 开关开启（或缺省）：仍按档位判定', () => {
    expect(shouldNotify('always', true, 'uiRequest', true)).toBe(true);
    expect(shouldNotify('off', false, 'uiRequest', true)).toBe(false);
    expect(shouldNotify('unfocused', false, 'uiRequest', undefined)).toBe(true);
    expect(shouldNotify('unfocused', true, 'uiRequest', undefined)).toBe(false);
  });

  it('runCompleted 不受 notifyUiRequest 开关影响', () => {
    expect(shouldNotify('always', true, 'runCompleted', false)).toBe(true);
    expect(shouldNotify('unfocused', false, 'runCompleted', false)).toBe(true);
  });
});
