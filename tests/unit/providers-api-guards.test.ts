import { describe, expect, it, vi } from 'vitest';

vi.mock('@electron/services/pi-adapter', () => ({
  loadPiAdapter: vi.fn(),
}));

vi.mock('@electron/services/pi-runtime-api', () => ({
  piRuntimeApi: {},
  reloadRuntimeSettings: vi.fn(),
  resolveRuntimeForContext: vi.fn(),
  resolveRuntimeForContextReady: vi.fn(),
}));

vi.mock('@electron/utils/host-fetch', () => ({
  hostFetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({
      data: [{ id: 'claude-3-5-sonnet', input: ['text'] }],
      content: [{ type: 'text', text: 'pong' }],
      candidates: [{ content: { parts: [{ text: 'pong' }] } }],
    }),
    text: async () => JSON.stringify({
      data: [{ id: 'claude-3-5-sonnet', input: ['text'] }],
      content: [{ type: 'text', text: 'pong' }],
      candidates: [{ content: { parts: [{ text: 'pong' }] } }],
    }),
  }),
}));

import { providersApi } from '@electron/services/providers-api';
import { hostFetch } from '@electron/utils/host-fetch';

describe('providersApi parameter guards', () => {
  it('rejects empty and prototype pollution keys in removeCredential', async () => {
    expect(await providersApi.removeCredential({ providerId: '' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
    expect(await providersApi.removeCredential({ providerId: '__proto__' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
    expect(await providersApi.removeCredential({ providerId: 'constructor' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
  });

  it('rejects empty and prototype pollution keys in deleteCustom', async () => {
    expect(await providersApi.deleteCustom({ providerId: '' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
    expect(await providersApi.deleteCustom({ providerId: '__proto__' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
    expect(await providersApi.deleteCustom({ providerId: 'prototype' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
  });

  it('rejects empty and prototype pollution keys in addCustom', async () => {
    expect(await providersApi.addCustom({ id: '', name: 'test', baseUrl: 'http://localhost:8000', api: 'openai-completions', models: [] })).toEqual({
      success: false,
      error: 'invalid provider id',
    });
    expect(await providersApi.addCustom({ id: '__proto__', name: 'test', baseUrl: 'http://localhost:8000', api: 'openai-completions', models: [] })).toEqual({
      success: false,
      error: 'invalid provider id',
    });
    expect(await providersApi.addCustom({ id: 'constructor', name: 'test', baseUrl: 'http://localhost:8000', api: 'openai-completions', models: [] })).toEqual({
      success: false,
      error: 'invalid provider id',
    });
  });

  it('rejects empty and prototype pollution keys in updateCustom', async () => {
    expect(await providersApi.updateCustom({ providerId: '' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
    expect(await providersApi.updateCustom({ providerId: '__proto__' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
    expect(await providersApi.updateCustom({ providerId: 'constructor' })).toEqual({
      success: false,
      error: 'invalid providerId',
    });
  });

  it('probe: 协议验证时为 anthropic 附加 x-api-key，为 google 附加 x-goog-api-key', async () => {
    vi.mocked(hostFetch).mockClear();

    await providersApi.probe({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-123',
      verifyProtocols: true,
    });

    const calls = vi.mocked(hostFetch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // 寻找 anthropic-messages 请求
    const anthropicCall = calls.find(([url]) => typeof url === 'string' && url.includes('messages'));
    expect(anthropicCall).toBeDefined();
    const anthropicHeaders = (anthropicCall![1]?.headers ?? {}) as Record<string, string>;
    expect(anthropicHeaders['x-api-key']).toBe('sk-test-secret-123');
    expect(anthropicHeaders['anthropic-version']).toBe('2023-06-01');

    // 寻找 google-generative-ai 请求
    const googleCall = calls.find(([url]) => typeof url === 'string' && url.includes(':generateContent'));
    expect(googleCall).toBeDefined();
    const googleHeaders = (googleCall![1]?.headers ?? {}) as Record<string, string>;
    expect(googleHeaders['x-goog-api-key']).toBe('sk-test-secret-123');
  });
});

