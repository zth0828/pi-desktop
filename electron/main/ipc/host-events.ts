// Main → Renderer 事件广播（按窗口 webContents.send）。
import { BrowserWindow, type WebContents } from 'electron';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type {
  HostEventArgs,
  HostEventModule,
  HostEventName,
} from '@shared/host-events/contract';

function eventChannel<M extends HostEventModule, E extends HostEventName<M>>(
  module: M,
  event: E,
): string {
  return (HOST_EVENT_CHANNELS[module] as Record<string, string>)[event];
}

export function sendHostEvent<M extends HostEventModule, E extends HostEventName<M>>(
  module: M,
  event: E,
  ...args: HostEventArgs<M, E>
): void {
  const channel = eventChannel(module, event);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

/** 仅向指定 renderer 发送事件，避免会话替换影响正在查看同一会话的其他窗口。 */
export function sendHostEventToWebContents<M extends HostEventModule, E extends HostEventName<M>>(
  webContents: WebContents,
  module: M,
  event: E,
  ...args: HostEventArgs<M, E>
): void {
  if (!webContents.isDestroyed()) webContents.send(eventChannel(module, event), ...args);
}

export function sendHostEventToWindow<M extends HostEventModule, E extends HostEventName<M>>(
  win: BrowserWindow,
  module: M,
  event: E,
  ...args: HostEventArgs<M, E>
): void {
  try {
    if (win && !(typeof win.isDestroyed === 'function' && win.isDestroyed())) {
      const wc = win.webContents;
      if (wc && !(typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
        sendHostEventToWebContents(wc, module, event, ...args);
      }
    }
  } catch {
    // 忽略窗口或 webContents 处于销毁过程中的访问异常
  }
}
