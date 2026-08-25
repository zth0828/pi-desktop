// Ported from ClawX: src/lib/host-api-client.ts（bridge 名 clawx → pidesktop）
import type {
  HostApiAction,
  HostApiModule,
  HostApiPayloadArgs,
  HostApiResult,
} from '@shared/host-api/contract';
import type { HostInvokeError } from '@shared/host-api/errors';
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

// 渲染层默认超时：host-invoke 正常往返在百毫秒级，超过 30s 视为 main 侧
// 卡死或响应丢失，按可识别错误上抛而不是让调用方永远挂起。
const DEFAULT_HOST_INVOKE_TIMEOUT_MS = 30_000;

// 慢操作豁免表（`module.action` → 超时毫秒）：这些 action 在 main 侧等待
// 完整的子进程或网络下载结束才返回（进度经 progress 事件流式推送），
// 正常耗时即可超过默认值，按各自的最坏合理耗时单独放宽。
const SLOW_HOST_ACTIONS_TIMEOUT_MS = new Map<string, number>([
  // 会话冷启动：pi SDK 动态加载 + 环境检测（spawn 子进程），慢环境下可达
  // 数十秒；调用方（chat-core start）自带 75s 业务级超时，这里放宽到 90s，
  // 保证业务超时先于通道超时触发，用户看到的是业务侧错误信息。
  ['piRuntime.start', 90_000],
  // 全局安装 pi / 安装扩展包 / 更新扩展包（update 可一次更新全部包）/
  // 下载应用更新安装包：慢网络下分钟级，通道超时只作最后防线。
  ['piSystem.install', 300_000],
  ['piPackages.install', 300_000],
  ['piPackages.update', 300_000],
  ['appUpdate.download', 300_000],
  // adapter 安装：main 侧内部自带 180s 子进程超时，通道超时必须晚于它触发。
  ['piMcp.installAdapter', 200_000],
  // 全量包更新检查：逐包访问 registry 元数据，包多或网络慢时超过默认值。
  ['piPackages.checkUpdates', 120_000],
]);

function hostInvokeTimeoutMs(module: string, action: string): number {
  return SLOW_HOST_ACTIONS_TIMEOUT_MS.get(`${module}.${action}`) ?? DEFAULT_HOST_INVOKE_TIMEOUT_MS;
}

function hostInvokeTimeoutError(timeoutMs: number, module: string, action: string): HostInvokeError {
  const error: HostInvokeError = new Error(
    `Host request timed out after ${timeoutMs}ms: ${module}.${action}`,
  );
  error.code = 'host-invoke-timeout';
  return error;
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

  const timeoutMs = hostInvokeTimeoutMs(module, action);
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    bridge<HostApiResult<M, A>>(request),
    new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(
        () => reject(hostInvokeTimeoutError(timeoutMs, module, action)),
        timeoutMs,
      );
    }),
    // 任一侧先出结果都立即清掉定时器，避免悬挂 timer 拖住事件循环。
  ]).finally(() => clearTimeout(timeoutTimer));

  if (!response.ok) {
    const error: HostInvokeError = new Error(
      response.error?.message || `Host request failed: ${module}.${action}`,
    );
    // main 侧 HostError 的 code 原样透传（普通错误为 'INTERNAL'），调用方按 code 分支。
    error.code = response.error?.code;
    throw error;
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
