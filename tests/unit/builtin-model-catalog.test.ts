import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findBuiltinModel,
  loadBuiltinModelCatalogFromDir,
  normalizeBuiltinModelId,
} from '../../electron/utils/builtin-model-catalog';

// 模拟 pi-ai dist/providers/data 目录结构：官方供应商文件 + openrouter 聚合目录
const dataDir = mkdtempSync(path.join(tmpdir(), 'pi-builtin-catalog-'));
writeFileSync(path.join(dataDir, 'anthropic.json'), JSON.stringify({
  'anthropic-messages': {
    'claude-opus-4-8': {
      id: 'claude-opus-4-8',
      contextWindow: 1000000,
      maxTokens: 128000,
      input: ['text', 'image'],
      reasoning: true,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
  },
}));
writeFileSync(path.join(dataDir, 'deepseek.json'), JSON.stringify({
  'openai-completions': {
    'deepseek-v4-flash': {
      id: 'deepseek-v4-flash',
      contextWindow: 1000000,
      maxTokens: 384000,
      input: ['text'],
      reasoning: false,
      cost: { input: 0.14, output: 0.28 },
    },
  },
}));
// 聚合网关：与官方冲突时（max 393216 vs 384000）不得覆盖官方条目
writeFileSync(path.join(dataDir, 'openrouter.json'), JSON.stringify({
  'openai-completions': {
    'anthropic/claude-opus-4.8': {
      id: 'anthropic/claude-opus-4.8',
      contextWindow: 1000000,
      maxTokens: 128000,
      input: ['text', 'image'],
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
    'deepseek/deepseek-v4-flash': {
      id: 'deepseek/deepseek-v4-flash',
      contextWindow: 1048576,
      maxTokens: 393216,
      input: ['text'],
    },
    // 目录未收录的新模型：聚合网关兜底
    'aionlp/aion-2.0': {
      id: 'aionlp/aion-2.0',
      contextWindow: 262144,
      maxTokens: 32768,
      input: ['text', 'image'],
    },
    'moonshotai/kimi-k2.6:free': {
      id: 'moonshotai/kimi-k2.6:free',
      contextWindow: 262144,
      maxTokens: 16384,
      input: ['text'],
    },
  },
}));

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('normalizeBuiltinModelId', () => {
  it('strips provider prefix, lowercases, and unifies version separators', () => {
    expect(normalizeBuiltinModelId('anthropic/claude-opus-4.8')).toBe('claude-opus-4-8');
    expect(normalizeBuiltinModelId('Claude-Opus-4-8')).toBe('claude-opus-4-8');
    expect(normalizeBuiltinModelId('gpt-5.6-sol')).toBe('gpt-5-6-sol');
    expect(normalizeBuiltinModelId('moonshotai/kimi-k2.6:free')).toBe('kimi-k2-6');
    expect(normalizeBuiltinModelId('deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });
});

describe('loadBuiltinModelCatalogFromDir + findBuiltinModel', () => {
  const catalog = loadBuiltinModelCatalogFromDir(dataDir);

  it('matches dot-style gateway ids against dash-style official ids', () => {
    // agentrouter/OpenRouter 点号版本风格 → anthropic 官方横杠风格
    const model = findBuiltinModel(catalog, 'claude-opus-4.8');
    expect(model?.contextWindow).toBe(1000000);
    expect(model?.maxTokens).toBe(128000);
    expect(model?.input).toEqual(['text', 'image']);
    expect(model?.cost).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  });

  it('prefers official provider entries over aggregator duplicates', () => {
    // deepseek 官方 max 384000，openrouter 转报 393216：取官方
    const model = findBuiltinModel(catalog, 'deepseek/deepseek-v4-flash');
    expect(model?.maxTokens).toBe(384000);
    expect(model?.contextWindow).toBe(1000000);
  });

  it('falls back to aggregator entries for models absent from official files', () => {
    const model = findBuiltinModel(catalog, 'aion-2.0');
    expect(model?.contextWindow).toBe(262144);
    expect(model?.input).toEqual(['text', 'image']);
  });

  it('ignores :free/:batch routing suffixes', () => {
    const model = findBuiltinModel(catalog, 'moonshotai/kimi-k2.6:free');
    expect(model?.maxTokens).toBe(16384);
  });

  it('returns undefined for unknown models', () => {
    expect(findBuiltinModel(catalog, 'totally-unknown-model')).toBeUndefined();
  });

  it('returns an empty catalog for a missing directory', () => {
    const empty = loadBuiltinModelCatalogFromDir(path.join(dataDir, 'does-not-exist'));
    expect(empty.size).toBe(0);
  });
});
