import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CloseConfirmDialog } from '../../src/components/CloseConfirmDialog';
import { renderToStaticMarkup } from 'react-dom/server';

let hostEventListener: (() => void) | null = null;
const confirmCloseMock = vi.fn();

vi.mock('../../src/lib/host-events', () => ({
  onHostEvent: (module: string, event: string, handler: () => void) => {
    if (module === 'windows' && event === 'closeRequested') {
      hostEventListener = handler;
    }
    return () => {
      hostEventListener = null;
    };
  },
}));

vi.mock('../../src/lib/host-api', () => ({
  hostApi: {
    windows: {
      confirmClose: (...args: any[]) => confirmCloseMock(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'closeConfirm.title': '关闭主窗口',
        'closeConfirm.message': '请选择关闭主窗口时的操作：',
        'closeConfirm.minimizeMac': '保持在后台运行',
        'closeConfirm.minimizeOther': '最小化到系统托盘',
        'closeConfirm.minimizeDescMac': '保持在后台运行，正在进行的任务不会中断，可随时重新打开。',
        'closeConfirm.minimizeDescOther': '保持在后台运行，正在进行的任务不会中断，可随时重新打开。',
        'closeConfirm.quit': '退出应用',
        'closeConfirm.quitDesc': '完全结束所有进程，终止当前正在进行的任务。',
        'closeConfirm.remember': '记住我的选择，下次不再提示',
        'closeConfirm.cancel': '取消',
        'closeConfirm.confirm': '确定',
        'common.close': '关闭',
      };
      return dict[key] ?? key;
    },
  }),
}));

describe('CloseConfirmDialog', () => {
  beforeEach(() => {
    hostEventListener = null;
    confirmCloseMock.mockClear();
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<CloseConfirmDialog />);
    expect(html).toBe('');
  });

  it('renders dialog elements when open', () => {
    const html = renderToStaticMarkup(<CloseConfirmDialog forceOpen={true} />);
    expect(html).toContain('data-testid="close-confirm-dialog"');
    expect(html).toContain('data-testid="close-confirm-option-minimize"');
    expect(html).toContain('data-testid="close-confirm-option-quit"');
    expect(html).toContain('data-testid="close-confirm-remember"');
    expect(html).toContain('data-testid="close-confirm-cancel"');
    expect(html).toContain('data-testid="close-confirm-confirm"');
    expect(html).toContain('关闭主窗口');
  });
});
