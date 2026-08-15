// windows 模块：多窗口管理。
// 窗口创建/聚焦全部委托 window-manager（窗口↔会话绑定的单一注册表）。
import type {
  WindowListEntry,
  WindowsFocusPayload,
  WindowsOpenDetachedAtPayload,
  WindowsOpenDetachedPayload,
} from '@shared/host-api/contract';
import {
  createSessionWindow,
  createSessionWindowAtPoint,
  focusWindowForSession,
  listWindows,
} from '../main/window-manager';
import { timingMark } from '../utils/timing';

export const windowsApi = {
  openDetached: (payload: WindowsOpenDetachedPayload): void => {
    timingMark('openDetached:recv');
    createSessionWindow(payload.sessionPath, payload.cwd);
  },
  openDetachedAt: (payload: WindowsOpenDetachedAtPayload): void => {
    createSessionWindowAtPoint(payload.sessionPath, payload.cwd, {
      x: payload.screenX,
      y: payload.screenY,
    });
  },
  focus: (payload: WindowsFocusPayload): void => {
    if (!focusWindowForSession(payload.sessionPath)) createSessionWindow(payload.sessionPath);
  },
  list: (): WindowListEntry[] => listWindows(),
};
