// 模型规格档案表：按模型 id 前缀匹配常见模型的能力档案。
// 第三方 OpenAI 兼容目录（vLLM/Ollama/网关）普遍不上报 context/maxTokens/input，
// 用户也不该手填这些值；探测到模型 id 后用这张表自动填充。
// 匹配按前缀最长优先（gpt-5.6 先于 gpt-5 命中）。

export type ModelInput = Array<'text' | 'image'>;

export type ModelProfile = {
  contextWindow: number;
  /** 单次最大输出 token；未知时不设（让 pi 用模型/供应商默认）。 */
  maxTokens?: number;
  /** 输入模态：支持图像输入（多模态）的模型为 ['text','image']；缺省视为 ['text']。 */
  input?: ModelInput;
};

const VISION_INPUT: ModelInput = ['text', 'image'];

type ProfileEntry = { prefix: string; profile: ModelProfile };

// 按 2025-2026 主流模型公开规格整理；前缀匹配不区分大小写。
// input 依据各家官方文档的图像输入支持情况标注。
export const MODEL_PROFILES: ProfileEntry[] = [
  // OpenAI（当前代）：gpt-4o 起全线支持图像输入，仅初代 gpt-4 纯文本
  { prefix: 'gpt-5.6', profile: { contextWindow: 400000, maxTokens: 128000, input: VISION_INPUT } },
  { prefix: 'gpt-5.5', profile: { contextWindow: 400000, maxTokens: 128000, input: VISION_INPUT } },
  { prefix: 'gpt-5.4', profile: { contextWindow: 400000, maxTokens: 128000, input: VISION_INPUT } },
  { prefix: 'gpt-5', profile: { contextWindow: 400000, maxTokens: 128000, input: VISION_INPUT } },
  { prefix: 'o4-mini', profile: { contextWindow: 200000, maxTokens: 100000, input: VISION_INPUT } },
  { prefix: 'o3', profile: { contextWindow: 200000, maxTokens: 100000, input: VISION_INPUT } },
  { prefix: 'gpt-4.1', profile: { contextWindow: 1048576, maxTokens: 32768, input: VISION_INPUT } },
  { prefix: 'gpt-4.5', profile: { contextWindow: 128000, maxTokens: 16384, input: VISION_INPUT } },
  { prefix: 'gpt-4o', profile: { contextWindow: 128000, maxTokens: 16384, input: VISION_INPUT } },
  { prefix: 'gpt-4-turbo', profile: { contextWindow: 128000, maxTokens: 4096, input: VISION_INPUT } },
  { prefix: 'gpt-4', profile: { contextWindow: 8192, maxTokens: 8192 } },
  { prefix: 'codex', profile: { contextWindow: 262144, maxTokens: 16384 } },
  // Anthropic：claude 3 起全线原生图像输入
  { prefix: 'claude-opus-4', profile: { contextWindow: 200000, maxTokens: 64000, input: VISION_INPUT } },
  { prefix: 'claude-sonnet-4', profile: { contextWindow: 200000, maxTokens: 64000, input: VISION_INPUT } },
  { prefix: 'claude-opus-4.5', profile: { contextWindow: 1000000, maxTokens: 64000, input: VISION_INPUT } },
  { prefix: 'claude-sonnet-4.5', profile: { contextWindow: 1000000, maxTokens: 64000, input: VISION_INPUT } },
  { prefix: 'claude-3.7', profile: { contextWindow: 200000, maxTokens: 64000, input: VISION_INPUT } },
  { prefix: 'claude-3.5', profile: { contextWindow: 200000, maxTokens: 64000, input: VISION_INPUT } },
  { prefix: 'claude-3', profile: { contextWindow: 200000, maxTokens: 4096, input: VISION_INPUT } },
  { prefix: 'claude', profile: { contextWindow: 200000, maxTokens: 64000, input: VISION_INPUT } },
  // Google：gemini 全系原生多模态；gemma-3 支持图像输入，旧代保守按纯文本
  { prefix: 'gemini-3', profile: { contextWindow: 1048576, maxTokens: 65536, input: VISION_INPUT } },
  { prefix: 'gemini-2.5', profile: { contextWindow: 1048576, maxTokens: 65536, input: VISION_INPUT } },
  { prefix: 'gemini-2.0', profile: { contextWindow: 1048576, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'gemini-1.5', profile: { contextWindow: 1048576, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'gemma-3', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'gemma', profile: { contextWindow: 32768, maxTokens: 8192 } },
  // DeepSeek：视觉走独立 VL 系，V 系/R 系纯文本
  { prefix: 'deepseek-vl', profile: { contextWindow: 32768, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'deepseek-v4', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  { prefix: 'deepseek-v3.2', profile: { contextWindow: 128000, maxTokens: 16384 } },
  { prefix: 'deepseek-v3', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'deepseek-r1', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'deepseek-chat', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'deepseek-reasoner', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'deepseek', profile: { contextWindow: 128000, maxTokens: 8192 } },
  // Qwen：视觉走 -vl/-omni 后缀系，基础系（max/plus/turbo/coder、qwen3）纯文本
  { prefix: 'qwen3-vl', profile: { contextWindow: 262144, maxTokens: 16384, input: VISION_INPUT } },
  { prefix: 'qwen2.5-vl', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'qwen-vl', profile: { contextWindow: 32768, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'qwen3-omni', profile: { contextWindow: 262144, maxTokens: 16384, input: VISION_INPUT } },
  { prefix: 'qwen2.5-omni', profile: { contextWindow: 32768, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'qwen-omni', profile: { contextWindow: 32768, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'qwen3.8', profile: { contextWindow: 262144, maxTokens: 16384 } },
  { prefix: 'qwen3.7', profile: { contextWindow: 262144, maxTokens: 16384 } },
  { prefix: 'qwen3-coder', profile: { contextWindow: 262144, maxTokens: 16384 } },
  { prefix: 'qwen3', profile: { contextWindow: 262144, maxTokens: 16384 } },
  { prefix: 'qwen2.5-coder', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'qwen2.5', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'qwen2', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'qwen-max', profile: { contextWindow: 32768, maxTokens: 8192 } },
  { prefix: 'qwen-turbo', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'qwen-plus', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'qwen', profile: { contextWindow: 131072, maxTokens: 8192 } },
  // 智谱 GLM：视觉走 v 后缀系（glm-4v/glm-4.5v），基础系纯文本
  { prefix: 'glm-4.5v', profile: { contextWindow: 65536, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'glm-4.6v', profile: { contextWindow: 65536, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'glm-5', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  { prefix: 'glm-4.5', profile: { contextWindow: 200000, maxTokens: 16384 } },
  { prefix: 'glm-4v', profile: { contextWindow: 128000, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'glm-4', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'glm', profile: { contextWindow: 128000, maxTokens: 8192 } },
  // Kimi / Moonshot：kimi-vl 开源视觉系，k2 对话语义纯文本
  { prefix: 'kimi-vl', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'kimi-k2.7', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  { prefix: 'kimi-k2.6', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  { prefix: 'kimi-k2.5', profile: { contextWindow: 262144, maxTokens: 16384 } },
  { prefix: 'kimi-k2', profile: { contextWindow: 262144, maxTokens: 16384 } },
  { prefix: 'kimi', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'moonshot', profile: { contextWindow: 131072, maxTokens: 8192 } },
  // MiniMax：vl 视觉系，m2 纯文本
  { prefix: 'minimax-vl', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'minimax-m2', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  { prefix: 'minimax', profile: { contextWindow: 131072, maxTokens: 8192 } },
  // Meta：Llama 4 原生多模态，3.x 仅 vision 后缀变体支持图像
  { prefix: 'llama-4-scout', profile: { contextWindow: 10485760, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'llama-4-maverick', profile: { contextWindow: 1048576, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'llama-4', profile: { contextWindow: 1048576, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'llama-3.2-11b-vision', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'llama-3.2-90b-vision', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'llama-3.3', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'llama-3.2', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'llama-3.1', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'llama-3', profile: { contextWindow: 8192, maxTokens: 8192 } },
  // Mistral：pixtral 视觉系，其余纯文本
  { prefix: 'pixtral', profile: { contextWindow: 131072, maxTokens: 8192, input: VISION_INPUT } },
  { prefix: 'mistral-large', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'mistral-medium', profile: { contextWindow: 32000, maxTokens: 8192 } },
  { prefix: 'mistral-small', profile: { contextWindow: 32000, maxTokens: 8192 } },
  { prefix: 'mixtral', profile: { contextWindow: 32000, maxTokens: 8192 } },
  { prefix: 'codestral', profile: { contextWindow: 256000, maxTokens: 8192 } },
  // xAI：grok-4 支持图像输入
  { prefix: 'grok-4', profile: { contextWindow: 262144, maxTokens: 32768, input: VISION_INPUT } },
  { prefix: 'grok-3', profile: { contextWindow: 262144, maxTokens: 32768 } },
  { prefix: 'grok-2', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'grok', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'command-r', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'nvidia', profile: { contextWindow: 131072, maxTokens: 8192 } },
  { prefix: 'yi-1.5', profile: { contextWindow: 128000, maxTokens: 8192 } },
  { prefix: 'yi-', profile: { contextWindow: 32768, maxTokens: 8192 } },
  { prefix: 'mimo-v2', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  { prefix: 'seed-2', profile: { contextWindow: 1000000, maxTokens: 16384 } },
  // 兜底：未匹配的模型用一个保守默认（纯文本）
  { prefix: '', profile: { contextWindow: 262144, maxTokens: 16384 } },
];

/** 按前缀匹配模型规格；空前缀兜底保证始终有返回值。
 * vLLM/Ollama 的模型 id 常带组织前缀（Qwen/Qwen3-VL-8B），除完整 id 外
 * 也匹配斜杠后的基础模型名。 */
export function matchModelProfile(modelId: string): ModelProfile {
  const normalized = modelId.toLowerCase();
  const candidates = normalized.includes('/')
    ? [normalized, normalized.split('/').pop() ?? '']
    : [normalized];
  let best: ModelProfile | undefined;
  let bestLength = -1;
  for (const candidate of candidates) {
    for (const { prefix, profile } of MODEL_PROFILES) {
      const p = prefix.toLowerCase();
      if (p && !candidate.startsWith(p)) continue;
      if (p.length > bestLength) {
        best = profile;
        bestLength = p.length;
      }
    }
  }
  return best ?? MODEL_PROFILES[MODEL_PROFILES.length - 1].profile;
}

/** 模型是否支持图像输入（多模态识别入口）。 */
export function supportsImageInput(modelId: string): boolean {
  return (matchModelProfile(modelId).input ?? ['text']).includes('image');
}
