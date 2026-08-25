import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeDiscoveredProviderModels,
  parseProviderModelDirectory,
  syncConfiguredProviderModels,
} from '../../electron/utils/configured-provider-models';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('configured provider model discovery', () => {
  it('parses OpenAI and Google model directory shapes', () => {
    expect(parseProviderModelDirectory({ data: [{ id: 'gpt-a' }, { id: 'gpt-a' }] }, 'openai-completions'))
      .toEqual([{ id: 'gpt-a' }]);
    expect(parseProviderModelDirectory({
      models: [{ name: 'models/gemini-a', displayName: 'Gemini A', input: ['text', 'image'] }],
    }, 'google-generative-ai')).toEqual([{
      id: 'gemini-a',
      name: 'Gemini A',
      input: ['text', 'image'],
    }]);
  });

  it('parses thinkingLevelMap from model directory or capabilities', () => {
    expect(parseProviderModelDirectory({
      data: [
        {
          id: 'model-with-map',
          thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
        },
        {
          id: 'model-with-snake-case',
          capabilities: { thinking_level_map: { off: 'none', low: 'low' } },
        },
      ],
    }, 'openai-completions')).toEqual([
      {
        id: 'model-with-map',
        thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
      },
      {
        id: 'model-with-snake-case',
        thinkingLevelMap: { off: 'none', low: 'low' },
      },
    ]);
  });

  it('preserves manual definitions and uses their provider defaults for new ids', () => {
    const existing = [{
      id: 'manual',
      name: 'Manual',
      reasoning: true,
      thinkingLevelMap: { off: null, max: 'max' },
      input: ['text'],
      contextWindow: 400000,
      maxTokens: 32768,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    }];
    expect(mergeDiscoveredProviderModels(existing, [
      { id: 'new-model', thinkingLevelMap: { off: 'none' } },
      { id: 'manual', thinkingLevelMap: { off: 'overwritten-attempt' } },
    ]))
      .toEqual([
        {
          id: 'new-model',
          name: 'new-model',
          reasoning: true,
          thinkingLevelMap: { off: 'none' },
          input: ['text'],
          contextWindow: 400000,
          maxTokens: 32768,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
        existing[0],
      ]);
  });

  it('fills a missing existing context window from provider discovery', () => {
    expect(mergeDiscoveredProviderModels(
      [{ id: 'existing-without-context', reasoning: false }],
      [{ id: 'existing-without-context', contextWindow: 128000 }],
    )).toEqual([{ id: 'existing-without-context', reasoning: false, contextWindow: 128000 }]);
  });

  it('backfills image input for known vision models when the directory is silent', () => {
    // 目录未上报 input：按规格表识别已知视觉模型
    const merged = mergeDiscoveredProviderModels([], [{ id: 'gemini-2.5-pro' }, { id: 'qwen3-32b' }]);
    expect(merged.find((m) => m.id === 'gemini-2.5-pro'))
      .toEqual(expect.objectContaining({ id: 'gemini-2.5-pro', input: ['text', 'image'] }));
    expect(merged.find((m) => m.id === 'qwen3-32b'))
      .toEqual(expect.objectContaining({ id: 'qwen3-32b', input: ['text'] }));
  });

  it('respects directory-reported input over the profile table', () => {
    // 目录显式 text：网关可能确实剥离了视觉，服务端声明优先
    const merged = mergeDiscoveredProviderModels([], [{ id: 'gemini-2.5-pro', input: ['text'] }]);
    expect(merged[0]).toEqual(expect.objectContaining({ id: 'gemini-2.5-pro', input: ['text'] }));
  });

  it('keeps manually declared input for existing models', () => {
    // 用户逐模型写过的 input（inputPinned）不被发现流程覆盖（与 reasoning 同策略）
    const existing = [{
      id: 'gemini-2.5-pro',
      reasoning: true,
      input: ['text'],
      inputPinned: true,
      contextWindow: 1048576,
    }];
    const merged = mergeDiscoveredProviderModels(existing, [{ id: 'gemini-2.5-pro', input: ['text', 'image'] }]);
    expect(merged[0]).toEqual(expect.objectContaining({ id: 'gemini-2.5-pro', input: ['text'] }));
  });

  it('upgrades legacy text-only input to vision when directory or profile recognises it', () => {
    // 历史版本一律写死 input: ['text'] 且无 pin 标记：视为陈旧缺省值，刷新时纠正
    const merged = mergeDiscoveredProviderModels(
      [{ id: 'gemini-2.5-pro', reasoning: true, input: ['text'], contextWindow: 1048576 }],
      [{ id: 'gemini-2.5-pro' }],
    );
    expect(merged[0]).toEqual(expect.objectContaining({ input: ['text', 'image'] }));
  });

  it('refreshes stale legacy fallback context window and missing maxTokens', () => {
    // 兜底 contextWindow（262144/128000）是历史缺省写入，用目录真实值替换
    const merged = mergeDiscoveredProviderModels(
      [{ id: 'gateway-model', reasoning: true, input: ['text'], contextWindow: 262144 }],
      [{ id: 'gateway-model', contextWindow: 1000000, maxTokens: 65536 }],
    );
    expect(merged[0]).toEqual(expect.objectContaining({ contextWindow: 1000000, maxTokens: 65536 }));
    // 用户改过的非兜底 contextWindow 不动
    const kept = mergeDiscoveredProviderModels(
      [{ id: 'gateway-model', reasoning: true, contextWindow: 32000 }],
      [{ id: 'gateway-model', contextWindow: 1000000 }],
    );
    expect(kept[0]).toEqual(expect.objectContaining({ contextWindow: 32000 }));
  });

  it('applies profile-table refresh to existing models missing from the directory', () => {
    // 手动 modelIds 添加、目录未列出的旧模型同样享受规格表识别（多模态/规格）
    const merged = mergeDiscoveredProviderModels(
      [{ id: 'qwen3-vl-plus', reasoning: true, input: ['text'], contextWindow: 128000 }],
      [{ id: 'other-model' }],
    );
    expect(merged.find((m) => m.id === 'qwen3-vl-plus'))
      .toEqual(expect.objectContaining({ input: ['text', 'image'] }));
  });


  it('defaults new third-party models to reasoning-capable when neither directory nor template says', () => {
    // 第三方目录普遍不上报推理能力：缺省按支持处理，让思考深度菜单可用
    expect(mergeDiscoveredProviderModels([], [{ id: 'gateway-model' }]))
      .toEqual([expect.objectContaining({ id: 'gateway-model', reasoning: true })]);
    // 目录显式上报 false 时仍然尊重（如 LM Studio 能力探测）
    expect(mergeDiscoveredProviderModels([], [{ id: 'plain-model', reasoning: false }]))
      .toEqual([expect.objectContaining({ id: 'plain-model', reasoning: false })]);
    // 模板显式 false 时新模型继承模板（用户已逐模型关闭的供应商）
    const inherited = mergeDiscoveredProviderModels(
      [{ id: 'manual', reasoning: false }],
      [{ id: 'sibling' }],
    );
    expect(inherited.find((m) => m.id === 'sibling'))
      .toEqual(expect.objectContaining({ id: 'sibling', reasoning: false }));
  });

  it('falls back to /v1/models for openai servers whose baseUrl lacks /v1 (vLLM style)', async () => {
    const agentDir = await mkdtemp(path.join(tmpdir(), 'pi-provider-discovery-v1-'));
    tempDirs.push(agentDir);
    const modelsPath = path.join(agentDir, 'models.json');
    await writeFile(modelsPath, JSON.stringify({
      providers: {
        vllm: {
          baseUrl: 'http://127.0.0.1:8000',
          api: 'openai-completions',
          models: [],
        },
      },
    }));
    const requested: string[] = [];
    const result = await syncConfiguredProviderModels({
      agentDir,
      providerId: 'vllm',
      api: 'openai-completions',
      auth: { apiKey: 'dummy' },
      fetchImpl: async (input) => {
        requested.push(String(input));
        if (String(input) === 'http://127.0.0.1:8000/models') {
          return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 });
        }
        return new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen3-8B' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(requested).toEqual([
      'http://127.0.0.1:8000/models',
      'http://127.0.0.1:8000/v1/models',
    ]);
    expect(result).toMatchObject({ discovered: 1, added: 1, changed: true });
  });

  it('throws the last candidate error when every directory candidate fails', async () => {
    const agentDir = await mkdtemp(path.join(tmpdir(), 'pi-provider-discovery-err-'));
    tempDirs.push(agentDir);
    const modelsPath = path.join(agentDir, 'models.json');
    await writeFile(modelsPath, JSON.stringify({
      providers: { down: { baseUrl: 'http://127.0.0.1:8000', api: 'openai-completions', models: [] } },
    }));
    await expect(syncConfiguredProviderModels({
      agentDir,
      providerId: 'down',
      api: 'openai-completions',
      auth: { apiKey: 'dummy' },
      fetchImpl: async () => new Response('{}', { status: 403 }),
    })).rejects.toThrow(/HTTP 403/);
  });

  it('requests /models with resolved auth and writes discovered ids to models.json', async () => {
    const agentDir = await mkdtemp(path.join(tmpdir(), 'pi-provider-discovery-'));
    tempDirs.push(agentDir);
    const modelsPath = path.join(agentDir, 'models.json');
    await writeFile(modelsPath, JSON.stringify({
      providers: {
        relay: {
          baseUrl: 'https://relay.example/v1',
          api: 'openai-completions',
          models: [{ id: 'manual', reasoning: false }],
        },
      },
    }));
    let requestedUrl = '';
    let authorization = '';
    const result = await syncConfiguredProviderModels({
      agentDir,
      providerId: 'relay',
      api: 'openai-completions',
      auth: { apiKey: 'secret' },
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return new Response(JSON.stringify({ data: [{ id: 'manual' }, { id: 'remote' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(requestedUrl).toBe('https://relay.example/v1/models');
    expect(authorization).toBe('Bearer secret');
    expect(result).toMatchObject({ discovered: 2, added: 1, changed: true });
    const saved = JSON.parse(await readFile(modelsPath, 'utf8')) as {
      providers: { relay: { models: Array<{ id: string }> } };
    };
    expect(saved.providers.relay.models.map((model) => model.id)).toEqual(['manual', 'remote']);
  });
});
