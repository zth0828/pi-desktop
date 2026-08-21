import { describe, expect, it } from 'vitest';
import {
  compatForOpenAi,
  placeholderApiKey,
  resolveServerType,
  thinkingLevelMapFor,
} from '../../electron/utils/custom-provider-config';

describe('custom provider 写库决策', () => {
  it('LM Studio：reasoning_effort 分级 + off 档映射 none（实测 enable_thinking 无效）', () => {
    expect(compatForOpenAi('lm-studio')).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
    });
    expect(thinkingLevelMapFor('lm-studio')).toEqual({ off: 'none' });
    expect(placeholderApiKey('lm-studio')).toBe('lm-studio');
  });

  it('vLLM：chat-template + chat_template_kwargs.enable_thinking（Qwen3 只认这个）', () => {
    expect(compatForOpenAi('vllm')).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      thinkingFormat: 'chat-template',
      chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' } },
    });
    // vLLM 用 $var 展开 enable_thinking，不需要模型级档位映射
    expect(thinkingLevelMapFor('vllm')).toBeUndefined();
    expect(placeholderApiKey('vllm')).toBe('local');
  });

  it('通用服务器：仅关闭 developer role / reasoning_effort', () => {
    expect(compatForOpenAi('generic')).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
    expect(thinkingLevelMapFor('generic')).toBeUndefined();
    expect(placeholderApiKey('generic')).toBe('local');
  });

  it('serverType 探测结果优先；缺失时按本地 LM Studio 特征回退', () => {
    expect(resolveServerType('vllm', 'anything', 'http://192.168.1.5:8000/v1')).toBe('vllm');
    expect(resolveServerType(undefined, 'local-llm', 'http://127.0.0.1:1234')).toBe('lm-studio');
    expect(resolveServerType(undefined, 'local-llm', 'http://127.0.0.1:11434/v1')).toBe('generic');
    expect(resolveServerType(undefined, 'remote', 'https://api.example.com/v1')).toBe('generic');
  });
});
