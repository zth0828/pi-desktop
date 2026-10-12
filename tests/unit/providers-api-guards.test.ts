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

vi.mock('@electron/main/ipc/host-events', () => ({
  sendHostEvent: vi.fn(),
}));

import { providersApi } from '@electron/services/providers-api';

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
});
