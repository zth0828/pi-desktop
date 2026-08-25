/**
 * Preload Script
 * Exposes the single host-api bridge to the renderer via contextBridge.
 * Renderer code must go through src/lib/host-api-client.ts.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { HostRequest, HostResponse } from '@shared/host-api/types';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

const validEventChannels = new Set<string>(
  Object.values(HOST_EVENT_CHANNELS).flatMap((moduleChannels) => Object.values(moduleChannels)),
);

// 每 channel 订阅计数：正常使用每 channel 只有 1~3 个监听，持续增长说明
// 有调用方订阅后未退订（如组件卸载漏 cleanup）。仅开发期提醒用途：超过
// 阈值 console.warn，不做强制限制。
const SUBSCRIPTION_WARN_THRESHOLD = 20;
const channelSubscriptionCounts = new Map<string, number>();

const piDesktopAPI = {
  hostInvoke: <T = unknown>(request: HostRequest): Promise<HostResponse<T>> =>
    ipcRenderer.invoke('host:invoke', request),

  /** Subscribe to a Main → Renderer host event. Returns an unsubscribe function. */
  onHostEvent: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!validEventChannels.has(channel)) {
      throw new Error(`Invalid host event channel: ${channel}`);
    }
    const count = (channelSubscriptionCounts.get(channel) ?? 0) + 1;
    channelSubscriptionCounts.set(channel, count);
    if (count > SUBSCRIPTION_WARN_THRESHOLD) {
      console.warn(
        `[pidesktop] host event "${channel}" has ${count} subscriptions; possible listener leak`,
      );
    }
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    };
    ipcRenderer.on(channel, subscription);
    return () => {
      channelSubscriptionCounts.set(
        channel,
        Math.max(0, (channelSubscriptionCounts.get(channel) ?? 1) - 1),
      );
      ipcRenderer.removeListener(channel, subscription);
    };
  },

  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
};

contextBridge.exposeInMainWorld('pidesktop', piDesktopAPI);

export type PiDesktopAPI = typeof piDesktopAPI;
