import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeLmStudioModels, parseLmStudioModels, syncLmStudioModels, isLocalServer, isLmStudioProvider } from '../../electron/utils/lmstudio-models';

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
    // 推理模型补 off 映射：LM Studio 只认 reasoning_effort，off 必须映射 none。
    expect((merged[0] as { thinkingLevelMap?: { off?: string } }).thinkingLevelMap).toEqual({ off: 'none' });
  });

  it('upgrades legacy LM Studio providers with a placeholder key and reasoning_effort thinking control', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lmstudio-sync-'));
    const originalFetch = globalThis.fetch;
    // 测试环境可能恰有真实 LM Studio 在跑，把 fetch 固定为失败（服务未启动路径）。
    globalThis.fetch = async () => ({ ok: false } as Response);
    try {
      writeFileSync(path.join(dir, 'models.json'), JSON.stringify({
        providers: {
          lmstudio: {
            baseUrl: 'http://127.0.0.1:1234/v1',
            api: 'openai-completions',
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, thinkingFormat: 'qwen' },
            models: [{ id: 'qwen/qwen3.8-27b', name: 'qwen3.8', reasoning: true }],
          },
          remote: {
            baseUrl: 'https://api.example.com/v1',
            api: 'openai-completions',
            models: [{ id: 'gpt-x', reasoning: true }],
          },
        },
      }));

      // 无 LM Studio 服务时仅升级配置（fetch 失败被吞掉），不丢已有 models。
      await expect(syncLmStudioModels(dir)).resolves.toBe(true);
      const doc = JSON.parse(readFileSync(path.join(dir, 'models.json'), 'utf8'));
      const lm = doc.providers.lmstudio;
      expect(lm.apiKey).toBe('lm-studio');
      expect(lm.compat).toEqual({ supportsDeveloperRole: false, supportsReasoningEffort: true });
      expect(lm.models[0].thinkingLevelMap).toEqual({ off: 'none' });
      // 非本地供应商不受影响。
      expect(doc.providers.remote.apiKey).toBeUndefined();
      expect(doc.providers.remote.compat).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps an existing placeholder key and does not rewrite when already upgraded', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lmstudio-sync-'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false } as Response);
    try {
      writeFileSync(path.join(dir, 'models.json'), JSON.stringify({
        providers: {
          lmstudio: {
            baseUrl: 'http://127.0.0.1:1234',
            api: 'openai-completions',
            apiKey: 'lm-studio',
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
            models: [{ id: 'm', name: 'm', reasoning: true, thinkingLevelMap: { off: 'none' } }],
          },
        },
      }));

      // 已升级配置不产生写入（fetch 失败不应触发 changed）。
      await expect(syncLmStudioModels(dir)).resolves.toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('local server detection (addCustom 写库决策)', () => {
  it('回环地址判定为本地服务器', () => {
    for (const url of ['http://127.0.0.1:1234', 'http://127.0.0.1:1234/v1', 'http://localhost:11434/v1', 'http://[::1]:8080']) {
      expect(isLocalServer(url)).toBe(true);
    }
    for (const url of ['https://api.example.com/v1', 'http://192.168.1.5:8080', 'not-a-url']) {
      expect(isLocalServer(url)).toBe(false);
    }
  });

  it('LM Studio 识别：本机 1234 端口或 id/name 含 lmstudio', () => {
    expect(isLmStudioProvider('lmstudio', { baseUrl: 'http://127.0.0.1:1234' })).toBe(true);
    expect(isLmStudioProvider('local-llm', { baseUrl: 'http://localhost:1234/v1' })).toBe(true);
    expect(isLmStudioProvider('local-llm', { name: 'LM Studio' })).toBe(true);
    expect(isLmStudioProvider('local-llm', { baseUrl: 'http://127.0.0.1:11434/v1' })).toBe(false);
    expect(isLmStudioProvider('local-llm', { baseUrl: 'https://api.example.com' })).toBe(false);
  });
});
