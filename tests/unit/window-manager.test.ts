// window-manager 注册表行为：注册/绑定/反查/销毁清理/按会话聚焦。
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeBrowserWindow {
  static sequence = 0;
  webContents = { id: ++FakeBrowserWindow.sequence };
  private listeners = new Map<string, Array<() => void>>();
  destroyed = false;
  minimized = false;
  focused = false;
  bounds: { x: number; y: number; width: number; height: number };
  constructor(options: { x?: number; y?: number; width?: number; height?: number } = {}) {
    this.bounds = {
      x: options.x ?? 100,
      y: options.y ?? 100,
      width: options.width ?? 1280,
      height: options.height ?? 800,
    };
  }
  loadURL(): void {}
  loadFile(): void {}
  on(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isFocused(): boolean {
    return this.focused;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds };
  }
  restore(): void {
    this.minimized = false;
  }
  focus(): void {
    this.focused = true;
  }
  close(): void {
    this.destroyed = true;
    for (const cb of this.listeners.get('closed') ?? []) cb();
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 875 } }),
  },
  app: { isPackaged: false },
}));

type WindowManager = typeof import('@electron/main/window-manager');

let wm: WindowManager;

beforeEach(async () => {
  vi.resetModules();
  wm = await import('@electron/main/window-manager');
});

function fakeWindow(): FakeBrowserWindow {
  return new FakeBrowserWindow() as unknown as FakeBrowserWindow;
}

describe('window-manager registry', () => {
  it('register/resolve: 未绑定的窗口 sessionPath 为 null', () => {
    const win = fakeWindow();
    wm.registerWindow(win as never);
    expect(wm.resolveWindowSession(win.webContents.id)).toBeNull();
    // 未注册的 webContentsId 同样为 null
    expect(wm.resolveWindowSession(999999)).toBeNull();
  });

  it('bindWindowSession 后可按会话反查窗口', () => {
    const win = fakeWindow();
    wm.registerWindow(win as never);
    wm.bindWindowSession(win.webContents.id, '/tmp/session-a.jsonl');
    expect(wm.resolveWindowSession(win.webContents.id)).toBe('/tmp/session-a.jsonl');
    expect(wm.findWindowBySession('/tmp/session-a.jsonl')).toBe(win);
    expect(wm.findWindowBySession('/tmp/other.jsonl')).toBeNull();
  });

  it('窗口 destroyed 时自动从注册表清除', () => {
    const win = fakeWindow();
    wm.registerWindow(win as never, { isMain: true });
    wm.bindWindowSession(win.webContents.id, '/tmp/session-b.jsonl');
    win.close();
    expect(wm.resolveWindowSession(win.webContents.id)).toBeNull();
    expect(wm.findWindowBySession('/tmp/session-b.jsonl')).toBeNull();
    expect(wm.getMainWindow()).toBeNull();
  });

  it('getMainWindow 只认 isMain 窗口', () => {
    const main = fakeWindow();
    const detached = fakeWindow();
    wm.registerWindow(detached as never);
    wm.registerWindow(main as never, { isMain: true });
    expect(wm.getMainWindow()).toBe(main);
  });

  it('focusWindowForSession 聚焦绑定窗口（最小化先 restore）', () => {
    const win = fakeWindow();
    wm.registerWindow(win as never);
    wm.bindWindowSession(win.webContents.id, '/tmp/session-c.jsonl');
    win.minimized = true;
    expect(wm.focusWindowForSession('/tmp/session-c.jsonl')).toBe(true);
    expect(win.minimized).toBe(false);
    expect(win.focused).toBe(true);
    expect(wm.focusWindowForSession('/tmp/none.jsonl')).toBe(false);
  });

  it('createSessionWindow 绑定会话；同会话重复调用聚焦复用', () => {
    const win = wm.createSessionWindow('/tmp/session-d.jsonl') as unknown as FakeBrowserWindow;
    expect(wm.resolveWindowSession(win.webContents.id)).toBe('/tmp/session-d.jsonl');
    const again = wm.createSessionWindow('/tmp/session-d.jsonl') as unknown as FakeBrowserWindow;
    expect(again).toBe(win);
    expect(again.focused).toBe(true);
  });

  it('createMainWindow 注册为主窗口且不带会话绑定', () => {
    const win = wm.createMainWindow() as unknown as FakeBrowserWindow;
    expect(wm.getMainWindow()).toBe(win);
    expect(wm.resolveWindowSession(win.webContents.id)).toBeNull();
  });

  it('rebindWindowSession 把绑定旧会话文件的窗口改绑到新文件（fork/newSession 后）', () => {
    const win = fakeWindow();
    const other = fakeWindow();
    wm.registerWindow(win as never);
    wm.registerWindow(other as never);
    wm.bindWindowSession(win.webContents.id, '/tmp/session-old.jsonl');
    wm.bindWindowSession(other.webContents.id, '/tmp/session-keep.jsonl');
    wm.rebindWindowSession('/tmp/session-old.jsonl', '/tmp/session-new.jsonl');
    expect(wm.resolveWindowSession(win.webContents.id)).toBe('/tmp/session-new.jsonl');
    expect(wm.findWindowBySession('/tmp/session-new.jsonl')).toBe(win);
    // 其他窗口的绑定不受影响
    expect(wm.resolveWindowSession(other.webContents.id)).toBe('/tmp/session-keep.jsonl');
  });

  it('listWindows 返回绑定清单（跳过已销毁窗口）', () => {
    const main = wm.createMainWindow() as unknown as FakeBrowserWindow;
    const detached = wm.createSessionWindow('/tmp/session-e.jsonl') as unknown as FakeBrowserWindow;
    const gone = fakeWindow();
    wm.registerWindow(gone as never);
    gone.close();
    const rows = wm.listWindows();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      windowId: main.webContents.id,
      sessionPath: null,
      isMain: true,
      focused: false,
    });
    expect(rows).toContainEqual({
      windowId: detached.webContents.id,
      sessionPath: '/tmp/session-e.jsonl',
      isMain: false,
      focused: false,
    });
  });
});

describe('createSessionWindowAtPoint（M3 拖出开窗）', () => {
  it('落点在任一 app 窗口内 → 不开窗（返回 null）', () => {
    const main = wm.createMainWindow() as unknown as FakeBrowserWindow;
    // 主窗口 bounds 默认 (100,100,1376,836)；(500,400) 落在其中
    expect(wm.createSessionWindowAtPoint('/tmp/session-f.jsonl', undefined, { x: 500, y: 400 })).toBeNull();
    expect(wm.listWindows()).toHaveLength(1);
    expect(wm.findWindowBySession('/tmp/session-f.jsonl')).toBeNull();
    expect(main.focused).toBe(false);
  });

  it('落点在所有窗口之外 → 以落点为中心开窗并 clamp 到 workArea', () => {
    wm.createMainWindow();
    // 窗口尺寸 1376x836（1440x900 workAreaSize 推导）；落点 (2000,500) 在主窗口外
    const win = wm.createSessionWindowAtPoint('/tmp/session-g.jsonl', '/tmp/ws', {
      x: 2000,
      y: 500,
    }) as unknown as FakeBrowserWindow;
    expect(win).not.toBeNull();
    // 居中 x=2000-688=1312 → clamp 到 1440-1376=64；y=500-418=82 → clamp 到 875-836=39
    expect(win.getBounds()).toEqual({ x: 64, y: 39, width: 1376, height: 836 });
    expect(wm.resolveWindowSession(win.webContents.id)).toBe('/tmp/session-g.jsonl');
  });

  it('落点在窗口外但会话已有窗口 → 聚焦复用（不新开）', () => {
    const existing = wm.createSessionWindow('/tmp/session-h.jsonl') as unknown as FakeBrowserWindow;
    const win = wm.createSessionWindowAtPoint('/tmp/session-h.jsonl', undefined, {
      x: 3000,
      y: 1000,
    }) as unknown as FakeBrowserWindow;
    expect(win).toBe(existing);
    expect(win.focused).toBe(true);
  });
});
