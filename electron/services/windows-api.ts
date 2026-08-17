// windows 模块：多窗口管理。
// 窗口创建/聚焦全部委托 window-manager（窗口↔会话绑定的单一注册表）。
import type {
  WindowListEntry,
  WindowsFocusPayload,
  WindowsOpenDetachedAtPayload,
  WindowsOpenDetachedPayload,
  WindowsSetSessionsPayload,
} from '@shared/host-api/contract';
import {
  createSessionWindow,
  createSessionWindowAtPoint,
  findWindowBySession,
  claimWindowSession,
  focusWindowForSession,
  listWindows,
  setWindowSessions,
} from '../main/window-manager';
import type { HostActionContext } from '../main/ipc/host-contract';
import { sendHostEventToWindow } from '../main/ipc/host-events';
import { prewarmSessionRuntime } from './pi-runtime-api';
import { timingMark } from '../utils/timing';

export const windowsApi = {
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
  openDetachedAt: (payload: WindowsOpenDetachedAtPayload): void => {
    const existing = findWindowBySession(payload.sessionPath);
    const win = createSessionWindowAtPoint(payload.sessionPath, payload.cwd, {
      x: payload.screenX,
      y: payload.screenY,
    });
    if (!win) return;
    if (existing) {
      // 拖出已打开会话时复用持有窗口，并激活其中的对应面板。
      sendHostEventToWindow(win, 'windows', 'focusSession', { sessionPath: payload.sessionPath });
      return;
    }
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
};
