import type { HostApiAction, HostApiModule, HostApiPayload } from './contract';

export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
  // 显式会话寻址（缺省由 main 侧回退窗口绑定 → 全局 active）
  sessionPath?: string;
};

export type TypedHostRequest<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = {
  id: string;
  module: M;
  action: A;
  payload?: HostApiPayload<M, A>;
  sessionPath?: string;
};

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error?: { code?: string; message?: string; details?: unknown } };
