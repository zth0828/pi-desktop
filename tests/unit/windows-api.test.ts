// windows-api：契约 action 到 window-manager 的委托与回退。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSessionWindow: vi.fn(),
  createSessionWindowAtPoint: vi.fn(),
  findWindowBySession: vi.fn(),
  claimWindowSession: vi.fn(),
  focusWindowForSession: vi.fn(),
  setWindowSessions: vi.fn(),
  listWindows: vi.fn(),
}));

vi.mock('@electron/main/window-manager', () => ({
  createSessionWindow: mocks.createSessionWindow,
  createSessionWindowAtPoint: mocks.createSessionWindowAtPoint,
  findWindowBySession: mocks.findWindowBySession,
  claimWindowSession: mocks.claimWindowSession,
  focusWindowForSession: mocks.focusWindowForSession,
  setWindowSessions: mocks.setWindowSessions,
  listWindows: mocks.listWindows,
}));

vi.mock('@electron/main/ipc/host-events', () => ({
  sendHostEventToWindow: vi.fn(),
}));

// expandRight/restoreExpandRight 的 BrowserWindow/screen 访问走 ctx.sender 上挂的假窗口
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: (sender: { win?: unknown }) => sender?.win ?? null,
  },
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 2560, height: 1440 } }),
  },
}));

import { windowsApi } from '@electron/services/windows-api';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('windowsApi', () => {
  it('openDetached 委托 createSessionWindow（透传 sessionPath/cwd）', () => {
    windowsApi.openDetached({ sessionPath: '/tmp/a.jsonl', cwd: '/tmp/ws' });
    expect(mocks.createSessionWindow).toHaveBeenCalledWith('/tmp/a.jsonl', '/tmp/ws');
  });

  it('openDetachedAt 委托 createSessionWindowAtPoint（屏幕坐标转 point）', () => {
    windowsApi.openDetachedAt({ sessionPath: '/tmp/a.jsonl', cwd: '/tmp/ws', screenX: 2000, screenY: 500 });
    expect(mocks.createSessionWindowAtPoint).toHaveBeenCalledWith('/tmp/a.jsonl', '/tmp/ws', {
      x: 2000,
      y: 500,
    });
    expect(mocks.createSessionWindow).not.toHaveBeenCalled();
  });

  it('focus：已有绑定窗口则聚焦，不新建', () => {
    mocks.focusWindowForSession.mockReturnValue(true);
    windowsApi.focus({ sessionPath: '/tmp/a.jsonl' });
    expect(mocks.focusWindowForSession).toHaveBeenCalledWith('/tmp/a.jsonl');
    expect(mocks.createSessionWindow).not.toHaveBeenCalled();
  });

  it('focus：无绑定窗口时新建独立窗口', () => {
    mocks.focusWindowForSession.mockReturnValue(false);
    windowsApi.focus({ sessionPath: '/tmp/b.jsonl' });
    expect(mocks.createSessionWindow).toHaveBeenCalledWith('/tmp/b.jsonl');
  });

  it('focusIfOpen 未找到窗口时返回 false，并为调用窗口预占会话', () => {
    mocks.findWindowBySession.mockReturnValue(null);
    expect(windowsApi.focusIfOpen(
      { sessionPath: '/tmp/missing.jsonl' },
      { sender: { id: 42 } } as never,
    )).toBe(false);
    expect(mocks.claimWindowSession).toHaveBeenCalledWith(42, '/tmp/missing.jsonl');
    expect(mocks.createSessionWindow).not.toHaveBeenCalled();
  });

  it('focusIfOpen 找到窗口时返回 true', () => {
    const win = {
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    };
    mocks.findWindowBySession.mockReturnValue(win);
    expect(windowsApi.focusIfOpen({ sessionPath: '/tmp/a.jsonl' })).toBe(true);
    expect(win.focus).toHaveBeenCalled();
  });

  it('setSessions 按 sender 绑定当前窗口的面板清单', () => {
    const sender = { id: 42 };
    windowsApi.setSessions(
      { sessionPaths: ['/tmp/a.jsonl', '/tmp/b.jsonl'], activeSessionPath: '/tmp/b.jsonl' },
      { sender } as never,
    );
    expect(mocks.setWindowSessions).toHaveBeenCalledWith(
      42,
      ['/tmp/a.jsonl', '/tmp/b.jsonl'],
      '/tmp/b.jsonl',
    );
  });

  it('list 返回 window-manager 的绑定清单', () => {
    const rows = [{ windowId: 1, sessionPath: null, isMain: true, focused: true }];
    mocks.listWindows.mockReturnValue(rows);
    expect(windowsApi.list()).toBe(rows);
  });

  describe('expandRight / restoreExpandRight', () => {
    const fakeWindow = (id: number, width: number, x = 100) => ({
      id,
      bounds: { x, y: 40, width, height: 800 },
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      getBounds() { return { ...this.bounds }; },
      setBounds: vi.fn(function (this: { bounds: { width: number } }, next: { width: number }) {
        this.bounds.width = next.width;
      }),
      once: vi.fn(),
    });
    const ctxFor = (win: unknown) => ({ sender: { id: 1, win } }) as never;

    it('右缘空间充足：按请求加宽并记录原宽', () => {
      const win = fakeWindow(11, 1200);
      const result = windowsApi.expandRight({ extraWidth: 656 }, ctxFor(win));
      expect(result).toEqual({ applied: 656 });
      expect(win.bounds.width).toBe(1856);
    });

    it('右缘空间不足：clamp 到可用空间', () => {
      const win = fakeWindow(12, 1200, 1200); // 右缘剩 2560-2400=160
      const result = windowsApi.expandRight({ extraWidth: 656 }, ctxFor(win));
      expect(result).toEqual({ applied: 160 });
      expect(win.bounds.width).toBe(1360);
    });

    it('已加宽的窗口重复调用不再加宽（多面板各开工作台）', () => {
      const win = fakeWindow(13, 1200);
      expect(windowsApi.expandRight({ extraWidth: 656 }, ctxFor(win))).toEqual({ applied: 656 });
      expect(windowsApi.expandRight({ extraWidth: 656 }, ctxFor(win))).toEqual({ applied: 0 });
      expect(win.bounds.width).toBe(1856);
      // count 语义：两次展开需两次 restore 才缩回
      windowsApi.restoreExpandRight(undefined, ctxFor(win));
      expect(win.bounds.width).toBe(1856);
      windowsApi.restoreExpandRight(undefined, ctxFor(win));
      expect(win.bounds.width).toBe(1200);
    });

    it('展开期间用户手动改过宽度：restore 放弃缩回', () => {
      const win = fakeWindow(14, 1200);
      windowsApi.expandRight({ extraWidth: 656 }, ctxFor(win));
      win.bounds.width = 2000; // 用户拖宽
      windowsApi.restoreExpandRight(undefined, ctxFor(win));
      expect(win.bounds.width).toBe(2000);
    });

    it('最大化窗口不加宽', () => {
      const win = fakeWindow(15, 1200);
      win.isMaximized.mockReturnValue(true);
      expect(windowsApi.expandRight({ extraWidth: 656 }, ctxFor(win))).toEqual({ applied: 0 });
      expect(win.setBounds).not.toHaveBeenCalled();
    });

    it('无 ctx / 无窗口时不动作', () => {
      expect(windowsApi.expandRight({ extraWidth: 656 })).toEqual({ applied: 0 });
      expect(() => windowsApi.restoreExpandRight()).not.toThrow();
    });
  });
});
