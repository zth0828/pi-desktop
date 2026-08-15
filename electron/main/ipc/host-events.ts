// Main → Renderer 事件广播（按窗口 webContents.send）。
import { BrowserWindow } from 'electron';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type {
  HostEventArgs,
  HostEventModule,
  HostEventName,
} from '@shared/host-events/contract';

export function sendHostEvent<M extends HostEventModule, E extends HostEventName<M>>(
  module: M,
  event: E,
  ...args: HostEventArgs<M, E>
): void {
  const channel = (HOST_EVENT_CHANNELS[module] as Record<string, string>)[event];
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}
