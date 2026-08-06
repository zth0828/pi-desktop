/**
 * Preload Script
 * Exposes the single host-api bridge to the renderer via contextBridge.
 * Renderer code must go through src/lib/host-api-client.ts (see AGENTS.md).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { HostRequest, HostResponse } from '@shared/host-api/types';

const piDesktopAPI = {
  hostInvoke: <T = unknown>(request: HostRequest): Promise<HostResponse<T>> =>
    ipcRenderer.invoke('host:invoke', request),
};

contextBridge.exposeInMainWorld('pidesktop', piDesktopAPI);

export type PiDesktopAPI = typeof piDesktopAPI;
