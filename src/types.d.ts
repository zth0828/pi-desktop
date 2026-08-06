import type { HostRequest, HostResponse } from '@shared/host-api/types';

declare global {
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
