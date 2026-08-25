import { describe, expect, it } from 'vitest';
import { matchModelProfile, supportsImageInput } from '../../shared/model-profiles';

describe('matchModelProfile', () => {
  it('matches known model prefixes case-insensitively', () => {
    expect(matchModelProfile('gpt-5.6-sol').contextWindow).toBe(400000);
    expect(matchModelProfile('GPT-5.5').contextWindow).toBe(400000);
    expect(matchModelProfile('deepseek-v4-pro').contextWindow).toBe(1000000);
    expect(matchModelProfile('qwen3.8-max').contextWindow).toBe(262144);
    expect(matchModelProfile('Qwen/Qwen3-8B').contextWindow).toBe(262144);
    expect(matchModelProfile('claude-sonnet-4-5').contextWindow).toBe(200000);
    expect(matchModelProfile('gemini-2.5-pro').contextWindow).toBe(1048576);
  });

  it('prefers the most specific prefix', () => {
    // gpt-5.6 先于 gpt-5 命中
    expect(matchModelProfile('gpt-5.6-sol').contextWindow).toBe(400000);
    expect(matchModelProfile('gpt-5-something').contextWindow).toBe(400000);
  });

  it('falls back to a conservative default for unknown models', () => {
    const profile = matchModelProfile('totally-unknown-model');
    expect(profile.contextWindow).toBe(262144);
    expect(profile.maxTokens).toBe(16384);
  });

  it('recognises mainstream vision-capable model ids', () => {
    for (const modelId of [
      'gpt-5.6', 'gpt-4o', 'gpt-4.1-mini', 'o3-mini', 'o4-mini',
      'claude-sonnet-4-5', 'claude-3.5-sonnet',
      'gemini-2.5-pro', 'gemini-3-pro',
      'qwen3-vl-8b', 'Qwen/Qwen3-VL-32B', 'qwen2.5-vl-72b-instruct', 'qwen3-omni-30b',
      'glm-4.5v', 'glm-4v-plus',
      'kimi-vl-a3b-thinking',
      'deepseek-vl2',
      'llama-4-scout-17b-16e', 'llama-3.2-90b-vision',
      'pixtral-large',
      'grok-4',
    ]) {
      expect(supportsImageInput(modelId), modelId).toBe(true);
    }
  });

  it('treats text-only model families as non-vision', () => {
    for (const modelId of [
      'gpt-4', 'codex-mini',
      'deepseek-v3-chat', 'deepseek-r1',
      'qwen3-32b', 'qwen-max', 'qwen3-coder-480b',
      'glm-4.5-air', 'glm-5',
      'kimi-k2-0905-preview',
      'llama-3.3-70b', 'llama-3.1-8b',
      'mistral-large-latest', 'mixtral-8x7b',
      'minimax-m2',
      'totally-unknown-model',
    ]) {
      expect(supportsImageInput(modelId), modelId).toBe(false);
    }
  });

  it('prefers the vision variant over the text base prefix', () => {
    // qwen3-vl 先于 qwen3、glm-4.5v 先于 glm-4.5 命中
    expect(matchModelProfile('qwen3-vl-8b').input).toEqual(['text', 'image']);
    expect(matchModelProfile('qwen3-8b').input).toBeUndefined();
    expect(matchModelProfile('glm-4.5v').input).toEqual(['text', 'image']);
    expect(matchModelProfile('glm-4.5-air').input).toBeUndefined();
  });
});
