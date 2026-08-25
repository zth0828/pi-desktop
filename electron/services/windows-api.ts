// windows 模块：多窗口管理。
// 窗口创建/聚焦全部委托 window-manager（窗口↔会话绑定的单一注册表）。
import { BrowserWindow, screen } from 'electron';
import type {
  WindowListEntry,
  WindowsExpandRightPayload,
  WindowsExpandRightResult,
  WindowsFocusPayload,
  WindowsOpenDetachedAtPayload,
  WindowsOpenDetachedPayload,
  WindowsSetSessionsPayload,
} from '@shared/host-api/contract';
import {
  createAppWindow,
  createSessionWindow,
  createSessionWindowAtPoint,
  findWindowBySession,
  claimWindowSession,
  focusWindowForSession,
  getWindowBounds,
  listWindows,
  resolveWindowSize,
  setWindowSessions,
} from '../main/window-manager';
import type { HostActionContext } from '../main/ipc/host-contract';
import { sendHostEventToWindow } from '../main/ipc/host-events';
import { prewarmSessionRuntime } from './pi-runtime-api';
import { timingMark } from '../utils/timing';
import { centerBoundsAtPoint, isPointInsideRects } from '../utils/detach-drop';
import { hashSessionPath, writePiDiagnostic } from '../utils/pi-diagnostic-log';
import { computeRightExpansion, shouldRestoreExpansion } from '../utils/window-bounds';

/** 每窗口的向右加宽状态：count 支持同窗口多面板各自展开工作台（只加宽一次，归零才缩回）。 */
type ExpandRightState = { originalWidth: number; applied: number; count: number };
const expandRightStates = new Map<number, ExpandRightState>();

export const windowsApi = {
  /** frameless 自绘窗口控件：从发起调用的 webContents 反查窗口。 */
  minimize: (_payload?: undefined, ctx?: HostActionContext): void => {
    if (ctx) BrowserWindow.fromWebContents(ctx.sender)?.minimize();
  },
  maximizeToggle: (_payload?: undefined, ctx?: HostActionContext): void => {
    const win = ctx ? BrowserWindow.fromWebContents(ctx.sender) : null;
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  },
  isMaximized: (_payload?: undefined, ctx?: HostActionContext): boolean => {
    return ctx ? BrowserWindow.fromWebContents(ctx.sender)?.isMaximized() ?? false : false;
  },
  // 关闭必须走 win.close()：window-manager 对主窗口拦截 close → hide 到托盘；
  // 退出流程（before-quit 置 quitting）自然放行。绝不在这里调 app.quit()。
  close: (_payload?: undefined, ctx?: HostActionContext): void => {
    if (ctx) BrowserWindow.fromWebContents(ctx.sender)?.close();
  },
  openDetached: (payload: WindowsOpenDetachedPayload): void => {
    timingMark('openDetached:recv');
    // 会话已经在主窗口或其他独立窗口时，不创建第二份；同时通知持有窗口激活对应面板。
    const existing = findWindowBySession(payload.sessionPath);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      sendHostEventToWindow(existing, 'windows', 'focusSession', { sessionPath: payload.sessionPath });
      return;
    }
    // 预热 runtime：与窗口创建/页面加载并行，renderer attach 的 switch 到达时复用在途创建
    prewarmSessionRuntime(payload.sessionPath, payload.cwd);
    createSessionWindow(payload.sessionPath, payload.cwd);
  },
  openDetachedAt: (payload: WindowsOpenDetachedAtPayload, ctx?: HostActionContext): void => {
    const existing = findWindowBySession(payload.sessionPath);
    if (existing) {
      const sourceWin = ctx ? BrowserWindow.fromWebContents(ctx.sender) : null;
      // 持有窗口不是拖拽源窗口：复用持有窗口（聚焦 + 激活对应面板），
      // 不建新窗，保证同一会话全局只归一个窗口。
      if (sourceWin?.webContents.id !== existing.webContents.id) {
        if (existing.isMinimized()) existing.restore();
        existing.focus();
        sendHostEventToWindow(existing, 'windows', 'focusSession', { sessionPath: payload.sessionPath });
        return;
      }
      // 持有窗口即拖拽源窗口：用户把本窗口打开的会话拖出 → 拆出独立窗口。
      // 落点在任一 app 窗口内（面板/侧栏等非落区位置）不拆出。
      const point = { x: payload.screenX, y: payload.screenY };
      if (isPointInsideRects(point, getWindowBounds())) return;
      // 不走 createSessionWindowAtPoint：它内部的 createSessionWindow 会复用
      // 持有窗口（源窗口）导致拆出永远不发生，这里直接按落点几何建窗。
      const display = screen.getDisplayNearestPoint(point);
      const bounds = centerBoundsAtPoint(point, resolveWindowSize(), display.workArea);
      createAppWindow({
        sessionPath: payload.sessionPath,
        cwd: payload.cwd,
        position: { x: bounds.x, y: bounds.y },
      });
      // 拆出后源窗口面板仍显示该会话，注册表出现双持有（findWindowBySession
      // 仍以源窗口为先）；冲突记诊断日志，focusSession 发给持有窗口激活其面板。
      writePiDiagnostic({
        level: 'warning',
        event: 'session.registry-conflict',
        module: 'windows',
        action: 'openDetachedAt',
        sessionPathHash: hashSessionPath(payload.sessionPath),
        detail: 'session torn out of its owning window, which still displays it',
      });
      sendHostEventToWindow(existing, 'windows', 'focusSession', { sessionPath: payload.sessionPath });
      return;
    }
    const win = createSessionWindowAtPoint(payload.sessionPath, payload.cwd, {
      x: payload.screenX,
      y: payload.screenY,
    });
    if (!win) return;
    prewarmSessionRuntime(payload.sessionPath, payload.cwd);
  },
  focus: (payload: WindowsFocusPayload): void => {
    if (!focusWindowForSession(payload.sessionPath)) createSessionWindow(payload.sessionPath);
  },
  /** 已有窗口则聚焦；未找到时先为调用窗口原子占用路径，再由 renderer 打开面板。 */
  focusIfOpen: (payload: WindowsFocusPayload, ctx?: HostActionContext): boolean => {
    const win = findWindowBySession(payload.sessionPath);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      sendHostEventToWindow(win, 'windows', 'focusSession', { sessionPath: payload.sessionPath });
      return true;
    }
    if (ctx) claimWindowSession(ctx.sender.id, payload.sessionPath);
    return false;
  },
  setSessions: (payload: WindowsSetSessionsPayload, ctx?: HostActionContext): void => {
    if (!ctx) return;
    setWindowSessions(ctx.sender.id, payload.sessionPaths, payload.activeSessionPath);
  },
  list: (): WindowListEntry[] => listWindows(),

  expandRight: (payload: WindowsExpandRightPayload, ctx?: HostActionContext): WindowsExpandRightResult => {
    const win = ctx ? BrowserWindow.fromWebContents(ctx.sender) : null;
    if (!win || win.isDestroyed()) return { applied: 0 };
    const existing = expandRightStates.get(win.id);
    if (existing) {
      existing.count += 1;
      return { applied: 0 };
    }
    if (win.isMaximized() || win.isFullScreen()) return { applied: 0 };
    const bounds = win.getBounds();
    const applied = computeRightExpansion(bounds, screen.getDisplayMatching(bounds).workArea, payload.extraWidth);
    if (applied <= 0) return { applied: 0 };
    expandRightStates.set(win.id, { originalWidth: bounds.width, applied, count: 1 });
    win.once('closed', () => expandRightStates.delete(win.id));
    // macOS 第二参开启动画；Windows 忽略该参数
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width + applied, height: bounds.height }, true);
    return { applied };
  },

  restoreExpandRight: (_payload?: undefined, ctx?: HostActionContext): void => {
    const win = ctx ? BrowserWindow.fromWebContents(ctx.sender) : null;
    if (!win || win.isDestroyed()) return;
    const state = expandRightStates.get(win.id);
    if (!state) return;
    state.count -= 1;
    if (state.count > 0) return;
    expandRightStates.delete(win.id);
    if (win.isMaximized() || win.isFullScreen()) return;
    const bounds = win.getBounds();
    if (!shouldRestoreExpansion(bounds.width, state.originalWidth, state.applied)) return;
    win.setBounds({ x: bounds.x, y: bounds.y, width: state.originalWidth, height: bounds.height }, true);
  },
};
