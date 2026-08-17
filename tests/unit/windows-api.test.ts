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
});
