/**
 * Preload Script
 * Exposes the single host-api bridge to the renderer via contextBridge.
 * Renderer code must go through src/lib/host-api-client.ts (see AGENTS.md).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { HostRequest, HostResponse } from '@shared/host-api/types';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

const validEventChannels = new Set<string>(
  Object.values(HOST_EVENT_CHANNELS).flatMap((moduleChannels) => Object.values(moduleChannels)),
);

const piDesktopAPI = {
  hostInvoke: <T = unknown>(request: HostRequest): Promise<HostResponse<T>> =>
    ipcRenderer.invoke('host:invoke', request),

  /** Subscribe to a Main → Renderer host event. Returns an unsubscribe function. */
  onHostEvent: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!validEventChannels.has(channel)) {
      throw new Error(`Invalid host event channel: ${channel}`);
    }
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    };
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },

  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
};

contextBridge.exposeInMainWorld('pidesktop', piDesktopAPI);

export type PiDesktopAPI = typeof piDesktopAPI;
