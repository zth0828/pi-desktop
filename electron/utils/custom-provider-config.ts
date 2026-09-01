// 自定义供应商写库决策（纯函数，独立可测）：按服务器类型决定 models.json
// 的 compat / 思考档位映射 / 占位 apiKey。addCustom 与 sync 逻辑都从这里取。
// 思考控制的服务器差异（对 OpenAI 兼容 chat/completions）：
// - LM Studio（llama.cpp server）：只认 reasoning_effort（native API
//   capabilities.reasoning.allowed_options 实测 enable_thinking / chat_template_kwargs
//   被忽略、off 档会按默认档位继续思考）。声明 supportsReasoningEffort=true +
//   模型级 thinkingLevelMap.off="none"，pi 在 off 档发 reasoning_effort:none 真正
//   关闭思考，其余档位分级直传（LM Studio 接受 none/minimal/low/medium/high/xhigh）。
// - vLLM（Qwen3 等推理模型）：chat template 只读 chat_template_kwargs.enable_thinking，
//   reasoning_effort / 顶层 enable_thinking 均不被 Qwen3 模板采用。用 pi 的
//   chat-template 格式按思考深度展开 enable_thinking（off → false，其余 → true）。
import type { PiProviderServerType } from '@shared/host-api/contract';
import { isLmStudioProvider, isLocalServer } from './lmstudio-models';

/** openai-completions / openai-responses 供应商的 compat 声明。 */
export function compatForOpenAi(serverType: PiProviderServerType): Record<string, unknown> {
  switch (serverType) {
    case 'lm-studio':
      return { supportsDeveloperRole: false, supportsReasoningEffort: true };
    case 'vllm':
      return {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        thinkingFormat: 'chat-template',
        chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' } },
      };
    default:
      return { supportsDeveloperRole: false, supportsReasoningEffort: false };
  }
}

/** 推理模型需要的思考档位映射（无分级需求的服务器返回 undefined）。 */
export function thinkingLevelMapFor(serverType: PiProviderServerType): Record<string, string> | undefined {
  return serverType === 'lm-studio' ? { off: 'none' } : undefined;
}

/** 本地无鉴权服务器的占位 apiKey（pi 请求时强制要求 key，服务器会忽略该值）。 */
export function placeholderApiKey(serverType: PiProviderServerType): string {
  return serverType === 'lm-studio' ? 'lm-studio' : 'local';
}

/**
 * 服务器类型判定：探测结果优先；未探测（旧渲染层/直接调用）时按
 * 本机回环 + LM Studio 特征回退，vLLM 只能由探测识别（无本地特征可判）。
 */
export function resolveServerType(
  serverType: PiProviderServerType | undefined,
  id: string,
  baseUrl: string,
): PiProviderServerType {
  if (serverType) return serverType;
  if (isLocalServer(baseUrl) && isLmStudioProvider(id, { baseUrl })) return 'lm-studio';
  return 'generic';
}
