/**
 * Host events contract — Main → Renderer 的推送通道。
 * 机制移植自 ClawX shared/host-events/contract.ts，通道清单按 Pi Desktop 收敛。
 */
import type { PiRuntimeEventEnvelope } from '../pi-event-map';
import type {
  PiOAuthProgressEvent,
  PiPackageProgressEvent,
  PiRuntimeStateResult,
} from '../host-api/contract';

export type PiInstallProgressEvent = {
  stream: 'stdout' | 'stderr' | 'status';
  text: string;
};

export type HostEventContract = {
  piSystem: {
    installProgress: (payload: PiInstallProgressEvent) => void;
  };
  piRuntime: {
    /** pi 会话事件（envelope 内含 sessionId/generation，渲染层据此丢弃过期事件） */
    event: (payload: PiRuntimeEventEnvelope) => void;
    /** new/switch/fork 后推送全量新状态，渲染层清空重载 */
    sessionReplaced: (payload: PiRuntimeStateResult) => void;
  };
  providers: {
    /** OAuth 授权进度（授权 URL 等），由 pi provider-owned 流程发出 */
    oauthProgress: (payload: PiOAuthProgressEvent) => void;
  };
  piPackages: {
    /** 包安装/卸载/更新进度（PackageManager.setProgressCallback 转发） */
    progress: (payload: PiPackageProgressEvent) => void;
  };
};

export type HostEventModule = keyof HostEventContract;
export type HostEventName<M extends HostEventModule> = keyof HostEventContract[M] & string;
export type HostEventHandler<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventContract[M][E];
export type HostEventArgs<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventHandler<M, E> extends (...args: infer Args) => void ? Args : never;

export const HOST_EVENT_CHANNELS = {
  piSystem: {
    installProgress: 'pi-system:install-progress',
  },
  piRuntime: {
    event: 'pi-runtime:event',
    sessionReplaced: 'pi-runtime:session-replaced',
  },
  providers: {
    oauthProgress: 'providers:oauth-progress',
  },
  piPackages: {
    progress: 'pi-packages:progress',
  },
} as const satisfies {
  [M in HostEventModule]: { [E in HostEventName<M>]: string };
};
