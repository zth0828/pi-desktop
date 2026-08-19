import { describe, expect, it } from 'vitest';
import { matchModelProfile } from '../../shared/model-profiles';

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
});
