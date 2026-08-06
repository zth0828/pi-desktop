/**
 * Host events contract — Main → Renderer 的推送通道。
 * 机制移植自 ClawX shared/host-events/contract.ts，通道清单按 Pi Desktop 收敛。
 * M1: piSystem.installProgress（npm 安装流式输出）。后续里程碑在此扩展
 * （pi:runtime-event 等）。
 */
export type PiInstallProgressEvent = {
  stream: 'stdout' | 'stderr' | 'status';
  text: string;
};

export type HostEventContract = {
  piSystem: {
    installProgress: (payload: PiInstallProgressEvent) => void;
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
} as const satisfies {
  [M in HostEventModule]: { [E in HostEventName<M>]: string };
};
