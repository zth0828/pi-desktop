// 窗口↔会话绑定的 main 侧注册表。
// renderer 的 hostInvoke 不带 sessionId；main 经 event.sender（webContentsId）
// 反查窗口绑定的会话，路由到对应 runtime（见 services/pi-runtime-api.ts 的
// resolveRuntimeForContext）。窗口关闭只解绑，runtime 仍保活在 runtimes Set 里。
import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { resolveAppPageId } from '@shared/app-page';
import { resolveAppIconPath, windowIconFormat } from '../utils/app-icon';
import { centerBoundsAtPoint, isPointInsideRects, type DetachPoint, type DetachRect } from '../utils/detach-drop';
import { samePath } from '../utils/same-path';
import { resolveMinSizeFor, resolveWindowSizeFor } from '../utils/window-bounds';
import { timingEnabled, timingMark } from '../utils/timing';
import { registerContextMenu } from './menu';

export type WindowRecord = {
  win: BrowserWindow;
  /** 窗口当前用于未显式寻址请求的会话文件；未绑定时为 null。 */
  sessionPath: string | null;
  /** 窗口内所有面板占用的会话文件，用于跨窗口重复打开判定。 */
  sessionPaths: Set<string>;
  isMain: boolean;
};

const windows = new Map<number, WindowRecord>();

// 应用退出流程标志：before-quit 置位后，主窗口 close 拦截放行（否则永远隐藏无法退出）。
let quitting = false;

export function setQuitting(value: boolean): void {
  quitting = value;
}

export function isQuitting(): boolean {
  return quitting;
}

/** 注册窗口（webContentsId 为键）；窗口 destroyed 时自动清除。 */
export function registerWindow(
  win: BrowserWindow,
  options: { isMain?: boolean; sessionPath?: string } = {},
): void {
  // 注意先取 id：'closed' 触发时 webContents 已销毁，再访问 .id 会抛
  // "Object has been destroyed"（uncaught → Electron 打断 quit 流程，进程退不掉）
  const id = win.webContents.id;
  windows.set(id, {
    win,
    sessionPath: options.sessionPath ?? null,
    sessionPaths: options.sessionPath ? new Set([options.sessionPath]) : new Set(),
    isMain: options.isMain ?? false,
  });
  win.on('closed', () => {
    windows.delete(id);
  });
}

export function bindWindowSession(webContentsId: number, sessionPath: string): void {
  const record = windows.get(webContentsId);
  if (!record) return;
  record.sessionPath = sessionPath;
  record.sessionPaths.add(sessionPath);
}

/** 替换窗口内所有面板的会话占用清单，并同步窗口级默认路由。 */
export function setWindowSessions(
  webContentsId: number,
  sessionPaths: string[],
  activeSessionPath?: string,
): void {
  const record = windows.get(webContentsId);
  if (!record) return;
  record.sessionPaths = new Set(sessionPaths);
  const active = activeSessionPath && sessionPaths.some((sessionPath) => samePath(sessionPath, activeSessionPath))
    ? activeSessionPath
    : record.sessionPath && sessionPaths.some((sessionPath) => samePath(sessionPath, record.sessionPath!))
      ? record.sessionPath
      : sessionPaths[0];
  record.sessionPath = active ?? null;
}

export function resolveWindowSession(webContentsId: number): string | null {
  return windows.get(webContentsId)?.sessionPath ?? null;
}

export function findWindowBySession(sessionPath: string, options: { detachedOnly?: boolean; excludeWindowId?: number } = {}): BrowserWindow | null {
  for (const [windowId, record] of windows.entries()) {
    if (record.win.isDestroyed()) continue;
    if (options.excludeWindowId === windowId) continue;
    if (options.detachedOnly && record.isMain) continue;
    if (record.sessionPath && samePath(record.sessionPath, sessionPath)) return record.win;
    if ([...record.sessionPaths].some((candidate) => samePath(candidate, sessionPath))) return record.win;
  }
  return null;
}

/** 是否还有其他窗口正在查看该会话；同一会话只允许由一个窗口持有。 */
export function hasSessionInOtherWindow(sessionPath: string, webContentsId: number): boolean {
  return findWindowBySession(sessionPath, { excludeWindowId: webContentsId }) !== null;
}

export function isMainWindow(webContentsId: number): boolean {
  return windows.get(webContentsId)?.isMain === true;
}

/** 只查找独立窗口，主窗口中的同一会话仍可另开一个独立窗口。 */
export function findDetachedWindowBySession(sessionPath: string): BrowserWindow | null {
  return findWindowBySession(sessionPath, { detachedOnly: true });
}

/** 只更新发起替换操作的窗口，避免同一会话被多个窗口查看时一起改绑。 */
export function rebindWindowSessionForWindow(
  webContentsId: number,
  oldPath: string,
  newPath: string,
): void {
  const record = windows.get(webContentsId);
  if (!record) return;
  if (record.sessionPath && samePath(record.sessionPath, oldPath)) record.sessionPath = newPath;
  record.sessionPaths = new Set([...record.sessionPaths].map((sessionPath) =>
    samePath(sessionPath, oldPath) ? newPath : sessionPath,
  ));
}

export function getMainWindow(): BrowserWindow | null {
  for (const record of windows.values()) {
    if (record.isMain && !record.win.isDestroyed()) return record.win;
  }
  return null;
}

/**
 * 恢复/聚焦主窗口：隐藏到托盘后窗口还在（isMain 的 close 被拦截为 hide），
 * 直接 show+focus；窗口已销毁（退出流程外异常）则重建。托盘、通知、对话框统一走这里。
 */
export function focusOrCreateMainWindow(): BrowserWindow {
  const existing = getMainWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    if (!existing.isVisible()) existing.show();
    existing.focus();
    return existing;
  }
  return createMainWindow();
}

/** 聚焦绑定了指定会话的窗口；没有对应窗口返回 false。 */
export function focusWindowForSession(sessionPath: string): boolean {
  const win = findWindowBySession(sessionPath);
  if (!win) return false;
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
  if (typeof win.isVisible === 'function' && !win.isVisible()) win.show();
  if (typeof app.focus === 'function') app.focus({ steal: true });
  win.focus();
  return true;
}

/**
 * 在 renderer 更新 pane tree 前先占用会话路径。IPC action 按 main 进程事件循环串行执行，
 * 因此“查找并占用”不会被另一个窗口的同类请求插入，避免两个窗口同时打开同一会话。
 */
export function claimWindowSession(webContentsId: number, sessionPath: string): boolean {
  const record = windows.get(webContentsId);
  if (!record || record.win.isDestroyed()) return false;
  const existing = findWindowBySession(sessionPath);
  if (existing && existing.webContents.id !== webContentsId) return false;
  record.sessionPaths.add(sessionPath);
  return true;
}

/** 会话替换（fork/newSession 产生新会话文件）后，把绑定旧文件的窗口改绑到新文件。 */
export function rebindWindowSession(oldPath: string, newPath: string): void {
  for (const record of windows.values()) {
    if (record.sessionPath && samePath(record.sessionPath, oldPath)) record.sessionPath = newPath;
    const replacement = [...record.sessionPaths].map((sessionPath) =>
      samePath(sessionPath, oldPath) ? newPath : sessionPath,
    );
    record.sessionPaths = new Set(replacement);
  }
}

/** 窗口↔会话绑定清单（windows.list，调试/测试用）。 */
export function listWindows(): Array<{
  windowId: number;
  sessionPath: string | null;
  isMain: boolean;
  focused: boolean;
}> {
  return [...windows.entries()]
    .filter(([, record]) => !record.win.isDestroyed())
    .map(([windowId, record]) => ({
      windowId,
      sessionPath: record.sessionPath,
      isMain: record.isMain,
      focused: record.win.isFocused(),
    }));
}

/** 所有存活 app 窗口的屏幕 bounds（拖出判定：落点在任一窗口内则不开窗）。 */
export function getWindowBounds(): DetachRect[] {
  return [...windows.values()]
    .filter((record) => !record.win.isDestroyed())
    .map((record) => record.win.getBounds());
}

type CreateWindowOptions = {
  isMain?: boolean;
  sessionPath?: string;
  /** 预留：独立窗口的工作区路径，目前会话 cwd 仍由 runtime 决定 */
  cwd?: string;
  /** 窗口左上角屏幕坐标（DIP）；缺省由 OS 层叠排布 */
  position?: { x: number; y: number };
};

/** 窗口默认尺寸（主窗口与独立会话窗口一致）；按落点居中时复用同一尺寸。 */
export function resolveWindowSize(): { width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  return resolveWindowSizeFor(workArea);
}

/** 统一的窗口创建入口：主窗口与独立会话窗口共用配置，创建即注册。 */
export function createAppWindow(options: CreateWindowOptions = {}): BrowserWindow {
  timingMark('window:create:start');
  const { width, height } = resolveWindowSize();
  const minSize = resolveMinSizeFor({ width, height });
  const icon = resolveAppIconPath(windowIconFormat(), {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: __dirname,
  });
  const win = new BrowserWindow({
    width,
    height,
    ...(options.position ? { x: options.position.x, y: options.position.y } : {}),
    // 侧栏 + 聊天列(420) + 右侧面板的最小可用宽度；窄于此面板自动转覆盖层（CSS 媒体查询）
    minWidth: minSize.width,
    minHeight: minSize.height,
    title: 'Pi Desktop',
    icon,
    // 让 macOS 原生红黄绿按钮叠在应用内容上，避免额外占一整行标题栏。
    // Windows/Linux 改为 frameless：标题栏（菜单 + 窗口控件）由 renderer 自绘，
    // Row 1 行带 -webkit-app-region:drag 负责拖动与双击语义。
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const query: Record<string, string> = {};
  // 耗时插桩随窗口传给渲染层（渲染层按 ?timing=1 开启同格式打点）
  if (timingEnabled()) query.timing = '1';
  if (options.sessionPath) {
    // 独立会话窗口：renderer 启动时按 ?session= 绑定该会话；cwd 一并带上，
    // renderer attach 直接用，省掉一次全量 listAll 扫描
    query.page = 'chat';
    query.session = options.sessionPath;
    query.detached = '1';
    if (options.cwd) query.cwd = options.cwd;
  } else {
    const canUseInitialPage = Boolean(process.env.VITE_DEV_SERVER_URL)
      || process.env.PI_DESKTOP_E2E === '1';
    const initialPage = canUseInitialPage
      ? resolveAppPageId(process.env.PI_DESKTOP_DEV_INITIAL_PAGE)
      : undefined;
    if (initialPage) query.page = initialPage;
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    win.loadURL(url.toString());
  } else {
    win.loadFile(
      path.join(__dirname, '../../dist/index.html'),
      Object.keys(query).length > 0 ? { query } : undefined,
    );
  }

  registerWindow(win, { isMain: options.isMain });
  registerContextMenu(win);
  if (options.sessionPath) bindWindowSession(win.webContents.id, options.sessionPath);
  // Windows/Linux：主窗口点关闭不退出，隐藏到托盘继续跑（托盘是恢复/退出入口）；
  // 退出流程（before-quit 置 quitting）放行真正关闭。macOS 走 dock activate 重建，不拦截。
  if (options.isMain && process.platform !== 'darwin') {
    win.on('close', (event) => {
      if (isQuitting()) return;
      event.preventDefault();
      win.hide();
    });
  }
  timingMark('window:create:done');
  if (timingEnabled()) {
    win.webContents.once('did-finish-load', () => timingMark('window:did-finish-load'));
  }
  return win;
}

export function createMainWindow(): BrowserWindow {
  return createAppWindow({ isMain: true });
}

/** 独立会话窗口：会话已被任一窗口持有时复用并聚焦，避免跨窗口重复查看。 */
export function createSessionWindow(
  sessionPath: string,
  cwd?: string,
  position?: { x: number; y: number },
): BrowserWindow {
  const existing = findWindowBySession(sessionPath);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }
  return createAppWindow({ sessionPath, cwd, position });
}

/**
 * 拖出开窗（windows.openDetachedAt）：落点在任一 app 窗口内则不动（返回 null），
 * 否则以落点为窗口中心创建，bounds clamp 到落点所在显示器的 workArea 内。
 */
export function createSessionWindowAtPoint(
  sessionPath: string,
  cwd: string | undefined,
  point: DetachPoint,
): BrowserWindow | null {
  if (isPointInsideRects(point, getWindowBounds())) return null;
  const display = screen.getDisplayNearestPoint(point);
  const bounds = centerBoundsAtPoint(point, resolveWindowSize(), display.workArea);
  return createSessionWindow(sessionPath, cwd, { x: bounds.x, y: bounds.y });
}
