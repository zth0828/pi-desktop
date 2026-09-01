import type { WebContents } from 'electron';
import type { HostApiContract } from '@shared/host-api/contract';
import type { HostErrorCode } from '@shared/host-api/errors';

export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
  // 显式会话寻址（缺省回退窗口绑定 → 全局 active）
  sessionPath?: string;
};

export type { HostErrorCode };

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error: { code: HostErrorCode; message: string; details?: unknown } };

/**
 * hostInvoke 调用方上下文：
 * 由 ipcMain.handle 注入，不经 IPC 传输（WebContents 不可序列化）。
 * sessionPath 是 sender 所属窗口绑定的会话（window-manager 解析，未绑定为 null），
 * action 据此路由到对应 runtime；缺省回退全局 active，单窗口行为不变。
 */
export type HostActionContext = {
  sender: WebContents;
  sessionPath: string | null;
  /** Renderer-generated request id for diagnostics and prompt lifecycle correlation. */
  requestId?: string;
};

export type RuntimeHostAction = (
  payload?: unknown,
  ctx?: HostActionContext,
) => Promise<unknown> | unknown;
type MaybePromise<T> = T | Promise<T>;

type HostServiceFunction<TFunction> = TFunction extends (...args: infer Args) => infer Result
  ? (...args: Args) => MaybePromise<Awaited<Result>>
  : never;

type HostServiceModule<TModule> = {
  [A in keyof TModule]: HostServiceFunction<TModule[A]>;
};

export type HostServiceRegistry = {
  [M in keyof HostApiContract]?: Partial<HostServiceModule<HostApiContract[M]>>;
};
export type CompleteHostServiceRegistry = {
  [M in keyof HostApiContract]: HostServiceModule<HostApiContract[M]>;
};

export type HostApiContribution = {
  module: string;
  actions: Record<string, RuntimeHostAction>;
};

export function isHostRequest(value: unknown): value is HostRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.module === 'string'
    && record.module.length > 0
    && typeof record.action === 'string'
    && record.action.length > 0
    && (record.sessionPath === undefined || typeof record.sessionPath === 'string');
}
