// Ported from ClawX: src/lib/host-api-client.ts（bridge 名 clawx → pidesktop）
import type {
  HostApiAction,
  HostApiModule,
  HostApiPayloadArgs,
  HostApiResult,
} from '@shared/host-api/contract';
import type { HostRequest, HostResponse, TypedHostRequest } from '@shared/host-api/types';

// 结构化取 bridge，避免依赖 DOM lib 的 window 全局（该文件也会被 node 侧测试引用）。
type HostInvokeBridge = <T = unknown>(request: HostRequest) => Promise<HostResponse<T>>;
function hostInvokeBridge(): HostInvokeBridge | undefined {
  return (globalThis as { window?: { pidesktop?: { hostInvoke?: HostInvokeBridge } } })
    .window?.pidesktop?.hostInvoke;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

async function invokeHostImpl<
  M extends HostApiModule,
  A extends HostApiAction<M>,
>(
  sessionPath: string | undefined,
  module: M,
  action: A,
  payloadArgs: HostApiPayloadArgs<M, A>,
): Promise<HostApiResult<M, A>> {
  const bridge = hostInvokeBridge();
  if (!bridge) {
    throw new Error('Host invoke bridge is unavailable');
  }

  const request: TypedHostRequest<M, A> = {
    id: createRequestId(),
    module,
    action,
  };
  if (payloadArgs.length > 0) {
    request.payload = payloadArgs[0];
  }
  if (sessionPath !== undefined) {
    request.sessionPath = sessionPath;
  }

  const response = await bridge<HostApiResult<M, A>>(request);

  if (!response.ok) {
    throw new Error(response.error?.message || `Host request failed: ${module}.${action}`);
  }

  return response.data;
}

export function invokeHost<
  M extends HostApiModule,
  A extends HostApiAction<M>,
>(
  module: M,
  action: A,
  ...payloadArgs: HostApiPayloadArgs<M, A>
): Promise<HostApiResult<M, A>> {
  return invokeHostImpl(undefined, module, action, payloadArgs);
}

// 面板作用域调用，信封带显式 sessionPath（main 侧优先于窗口绑定）。
export function scopedInvokeHost<
  M extends HostApiModule,
  A extends HostApiAction<M>,
>(
  sessionPath: string,
  module: M,
  action: A,
  ...payloadArgs: HostApiPayloadArgs<M, A>
): Promise<HostApiResult<M, A>> {
  return invokeHostImpl(sessionPath, module, action, payloadArgs);
}
