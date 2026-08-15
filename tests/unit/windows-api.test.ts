// windows-api：契约 action 到 window-manager 的委托与回退。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSessionWindow: vi.fn(),
  createSessionWindowAtPoint: vi.fn(),
  focusWindowForSession: vi.fn(),
  listWindows: vi.fn(),
}));

vi.mock('@electron/main/window-manager', () => ({
  createSessionWindow: mocks.createSessionWindow,
  createSessionWindowAtPoint: mocks.createSessionWindowAtPoint,
  focusWindowForSession: mocks.focusWindowForSession,
  listWindows: mocks.listWindows,
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

  it('list 返回 window-manager 的绑定清单', () => {
    const rows = [{ windowId: 1, sessionPath: null, isMain: true, focused: true }];
    mocks.listWindows.mockReturnValue(rows);
    expect(windowsApi.list()).toBe(rows);
  });
});
