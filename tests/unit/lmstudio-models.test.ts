import { describe, expect, it } from 'vitest';
import { mergeLmStudioModels, parseLmStudioModels } from '../../electron/utils/lmstudio-models';

describe('LM Studio model metadata sync', () => {
  it('discovers LLMs and maps native vision/reasoning/context metadata', () => {
    const models = parseLmStudioModels({
      models: [
        {
          key: 'qwen/qwen3.5-9b',
          display_name: 'Qwen3.5 9B',
          type: 'llm',
          max_context_length: 131072,
          capabilities: { vision: true, reasoning: { allowed_options: ['off', 'on'] } },
          loaded_instances: [{ config: { context_length: 262144 } }],
        },
        { key: 'text-embedding', type: 'embedding' },
      ],
    });

    expect(models).toEqual([{
      id: 'qwen/qwen3.5-9b',
      name: 'Qwen3.5 9B',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 262144,
    }]);
  });

  it('preserves user naming/output limit while correcting capabilities and context', () => {
    const merged = mergeLmStudioModels([
      {
        id: 'qwen/qwen3.5-9b',
        name: 'Qwen local',
        input: ['text'],
        reasoning: false,
        contextWindow: 32768,
        maxTokens: 32768,
        cost: { input: 0, output: 0 },
      },
    ], [{
      id: 'qwen/qwen3.5-9b',
      name: 'Qwen3.5 9B',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 262144,
    }]);

    expect(merged[0]).toMatchObject({
      name: 'Qwen local',
      input: ['text', 'image'],
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 32768,
    });
  });
});
