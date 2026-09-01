// notify-api 点击跳转分支单测：系统通知的 OS 级点击无法在无签名构建的
// E2E 里模拟，这里 mock electron 直接驱动 Notification 的 click 事件，
// 断言点击时按 sessionPath 定位会话窗口、restore/focus、发送 focusSession
// 激活对应面板；找不到会话窗口 / 无 sessionPath 时回退主窗口且不导航。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NotificationMock = vi.fn();
const findWindowBySessionMock = vi.fn();
const getMainWindowMock = vi.fn();
const sendHostEventToWindowMock = vi.fn();
const settingsGetMock = vi.fn();

// dispatch 后收集创建的 Notification 实例，测试里手动触发其 click 回调
const createdNotifications: Array<{ on: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }> = [];

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  // 必须用普通函数：notify-api 里是 `new Notification(...)`，箭头函数不可构造；
  // 且必须返回对象：构造函数返回非对象时 `new` 会忽略返回值改用 this
  Notification: function (...args: unknown[]) {
    const notification = { on: vi.fn(), show: vi.fn() };
    createdNotifications.push(notification);
    NotificationMock(...args);
    return notification;
  },
}));

vi.mock('@electron/main/window-manager', () => ({
  getMainWindow: (...args: unknown[]) => getMainWindowMock(...args),
  findWindowBySession: (...args: unknown[]) => findWindowBySessionMock(...args),
}));

vi.mock('@electron/main/ipc/host-events', () => ({
  sendHostEventToWindow: (...args: unknown[]) => sendHostEventToWindowMock(...args),
}));

vi.mock('@electron/services/settings-api', () => ({
  settingsApi: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

import { notifyApi } from '@electron/services/notify-api';

const SESSION_PATH = 'C:\\pi\\sessions\\demo\\2026-09-01.md';

function makeWindow(overrides: Record<string, unknown> = {}) {
  return {
    isMinimized: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
    focus: vi.fn(),
    show: vi.fn(),
    isVisible: vi.fn().mockReturnValue(true),
    isDestroyed: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

/** 触发最近一次 dispatch 创建的 Notification 的 click 回调。 */
function clickLastNotification(): void {
  const notification = createdNotifications.at(-1)!;
  const clickHandler = notification.on.mock.calls.find(([event]) => event === 'click')?.[1];
  expect(clickHandler).toBeTypeOf('function');
  clickHandler();
}

beforeEach(() => {
  vi.clearAllMocks();
  createdNotifications.length = 0;
  // 默认 always 档：dispatch 一定走创建 Notification 分支
  settingsGetMock.mockResolvedValue('always');
});

describe('notifyApi.dispatch 点击跳转', () => {
  it('有 sessionPath 且会话窗口存在：restore/focus 该窗口并发送 focusSession', async () => {
    const sessionWindow = makeWindow();
    findWindowBySessionMock.mockReturnValue(sessionWindow);

    await notifyApi.dispatch({
      kind: 'runCompleted',
      title: '完成',
      body: '摘要',
      sessionPath: SESSION_PATH,
    });

    expect(createdNotifications).toHaveLength(1);
    clickLastNotification();

    expect(findWindowBySessionMock).toHaveBeenCalledWith(SESSION_PATH);
    expect(sessionWindow.restore).not.toHaveBeenCalled(); // 未最小化
    expect(sessionWindow.focus).toHaveBeenCalled();
    // 关键：点击要激活会话所在窗口里的对应面板
    expect(sendHostEventToWindowMock).toHaveBeenCalledWith(
      sessionWindow,
      'windows',
      'focusSession',
      { sessionPath: SESSION_PATH },
    );
    expect(getMainWindowMock).not.toHaveBeenCalled(); // 命中了会话窗口，不回退
  });

  it('会话窗口最小化：点击先 restore 再 focus', async () => {
    const sessionWindow = makeWindow({ isMinimized: vi.fn().mockReturnValue(true) });
    findWindowBySessionMock.mockReturnValue(sessionWindow);

    await notifyApi.dispatch({
      kind: 'uiRequest',
      title: '需要确认',
      sessionPath: SESSION_PATH,
    });
    clickLastNotification();

    expect(sessionWindow.restore).toHaveBeenCalled();
    expect(sessionWindow.focus).toHaveBeenCalled();
    expect(sendHostEventToWindowMock).toHaveBeenCalledWith(sessionWindow, 'windows', 'focusSession', {
      sessionPath: SESSION_PATH,
    });
  });

  it('有 sessionPath 但会话窗口已关闭（找不到）：回退主窗口且不发 focusSession', async () => {
    const mainWindow = makeWindow();
    findWindowBySessionMock.mockReturnValue(null);
    getMainWindowMock.mockReturnValue(mainWindow);

    await notifyApi.dispatch({
      kind: 'runCompleted',
      title: '完成',
      sessionPath: SESSION_PATH,
    });
    clickLastNotification();

    expect(findWindowBySessionMock).toHaveBeenCalledWith(SESSION_PATH);
    expect(sendHostEventToWindowMock).not.toHaveBeenCalled(); // 没有目标面板可激活
    expect(mainWindow.focus).toHaveBeenCalled(); // 只聚焦主窗口兜底
  });

  it('无 sessionPath（in-memory 会话）：回退主窗口，不查找会话窗口', async () => {
    const mainWindow = makeWindow();
    getMainWindowMock.mockReturnValue(mainWindow);

    await notifyApi.dispatch({ kind: 'runCompleted', title: '完成', body: '摘要' });
    clickLastNotification();

    expect(findWindowBySessionMock).not.toHaveBeenCalled();
    expect(sendHostEventToWindowMock).not.toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
  });

  it('回退主窗口时最小化也会 restore、不可见会 show', async () => {
    const mainWindow = makeWindow({
      isMinimized: vi.fn().mockReturnValue(true),
      isVisible: vi.fn().mockReturnValue(false),
    });
    getMainWindowMock.mockReturnValue(mainWindow);

    await notifyApi.dispatch({ kind: 'runCompleted', title: '完成', sessionPath: SESSION_PATH });
    clickLastNotification();

    expect(mainWindow.restore).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
  });
});
