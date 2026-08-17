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

  it('preserves manual definitions and uses their provider defaults for new ids', () => {
    const existing = [{
      id: 'manual',
      name: 'Manual',
      reasoning: true,
      input: ['text'],
      contextWindow: 400000,
      maxTokens: 32768,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    }];
    expect(mergeDiscoveredProviderModels(existing, [{ id: 'new-model' }, { id: 'manual' }]))
      .toEqual([
        {
          id: 'new-model',
          name: 'new-model',
          reasoning: true,
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
