/**
 * Host API contract — the single source of truth for Renderer↔Main calls.
 * Renderer 只允许通过这里声明的 module.action 调后端（见 AGENTS.md）。
 * 机制移植自 ClawX，module 清单按 Pi Desktop 收敛（M1 起步，按里程碑扩展）。
 */
export type JsonRecord = Record<string, unknown>;
export type HostSuccess = { success: boolean; error?: string };

export type ShellOpenExternalPayload = { url: string };

export type HostApiContract = {
  app: {
    version: () => string;
    name: () => string;
    platform: () => string;
  };
  shell: {
    openExternal: (payload: ShellOpenExternalPayload) => void;
  };
};

export type HostApiModule = keyof HostApiContract & string;
export type HostApiAction<M extends HostApiModule> = keyof HostApiContract[M] & string;
export type HostApiFunction<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = HostApiContract[M][A] extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : never;
export type HostApiPayload<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? undefined
  : Parameters<HostApiFunction<M, A>>[0];
export type HostApiResult<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Awaited<ReturnType<HostApiFunction<M, A>>>;
export type HostApiPayloadArgs<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? []
  : undefined extends HostApiPayload<M, A>
    ? [payload?: HostApiPayload<M, A>]
    : [payload: HostApiPayload<M, A>];
