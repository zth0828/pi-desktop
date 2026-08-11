/// <reference types="vite/client" />

import type { HostRequest, HostResponse } from '@shared/host-api/types';

declare global {
  var pdfjsWorker: { WorkerMessageHandler: unknown } | undefined;

  interface Window {
    pidesktop: {
      hostInvoke: <T = unknown>(request: HostRequest) => Promise<HostResponse<T>>;
      onHostEvent: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      platform: string;
      isDev: boolean;
    };
  }
}

export {};
