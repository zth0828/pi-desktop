// host-invoke 错误码单点定义。
// 流向：main 侧 action 抛 HostError → dispatcher 透传 code/detail →
// 渲染层 host-api-client 抛出携带 code 的 Error，调用方按 code 分支处理。
// 内置协议码之外，各服务以 UPPER_SNAKE_CASE 字符串自定义业务码
// （如 MODEL_UNAVAILABLE、PI_NOT_READY），detail 携带结构化上下文
// （如 { providerId, modelId }）。

/** 内置协议错误码；`(string & {})` 保住字面量自动补全，同时允许各服务扩展业务码。 */
export type HostErrorCode = 'VALIDATION' | 'UNSUPPORTED' | 'INTERNAL' | (string & {});

/**
 * 服务实现抛出的可分类错误：dispatcher 将其 code/detail 透传给渲染层，
 * 而普通 Error 统一归类为 INTERNAL。
 */
export class HostError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'HostError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 渲染层 invokeHost 失败时抛出的错误形状：
 * code 为 main 侧 HostError 的 code（普通错误为 'INTERNAL'），
 * 或 client 本地的 'host-invoke-timeout'（IPC 超时）。
 */
export type HostInvokeError = Error & { code?: HostErrorCode };
