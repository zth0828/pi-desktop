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
import { prewarmSessionRuntime } from './pi-runtime-api';
import { timingMark } from '../utils/timing';

export const windowsApi = {
  openDetached: (payload: WindowsOpenDetachedPayload): void => {
    timingMark('openDetached:recv');
    // 预热 runtime：与窗口创建/页面加载并行，renderer attach 的 switch 到达时复用在途创建
    prewarmSessionRuntime(payload.sessionPath, payload.cwd);
    createSessionWindow(payload.sessionPath, payload.cwd);
  },
  openDetachedAt: (payload: WindowsOpenDetachedAtPayload): void => {
    const win = createSessionWindowAtPoint(payload.sessionPath, payload.cwd, {
      x: payload.screenX,
      y: payload.screenY,
    });
    // 落点在已有窗口内（不开窗）则不预热
    if (win) prewarmSessionRuntime(payload.sessionPath, payload.cwd);
  },
  focus: (payload: WindowsFocusPayload): void => {
    if (!focusWindowForSession(payload.sessionPath)) createSessionWindow(payload.sessionPath);
  },
  list: (): WindowListEntry[] => listWindows(),
};
