import { describe, expect, it } from 'vitest';
import { determineCatalogSource, formatModelRefreshSummary } from '@shared/provider-catalog';

describe('determineCatalogSource', () => {
  it('identifies builtin providers as builtin-static', () => {
    expect(determineCatalogSource({ source: 'builtin' })).toBe('builtin-static');
    expect(determineCatalogSource({ source: 'builtin', baseUrl: 'https://api.openai.com/v1' })).toBe('builtin-static');
  });

  it('identifies extension providers as builtin-static', () => {
    expect(determineCatalogSource({ source: 'extension' })).toBe('builtin-static');
  });

  it('identifies configured providers with baseUrl as dynamic-discovery', () => {
    expect(determineCatalogSource({ source: 'config', baseUrl: 'http://localhost:11434/v1' })).toBe('dynamic-discovery');
    expect(determineCatalogSource({ source: 'config', baseUrl: 'https://my-gateway.com' })).toBe('dynamic-discovery');
  });

  it('identifies LM Studio providers as dynamic-discovery even without baseUrl', () => {
    expect(determineCatalogSource({ source: 'config', isLmStudio: true })).toBe('dynamic-discovery');
  });

  it('identifies configured providers without baseUrl as custom-models-json', () => {
    expect(determineCatalogSource({ source: 'config' })).toBe('custom-models-json');
    expect(determineCatalogSource({ source: 'config', baseUrl: '' })).toBe('custom-models-json');
    expect(determineCatalogSource({ source: 'config', baseUrl: '   ' })).toBe('custom-models-json');
  });
});

describe('formatModelRefreshSummary', () => {
  const fakeT = (key: string, opts?: Record<string, unknown>) => {
    if (key === 'chat.modelMenu.refreshUpToDate') return 'Up to date';
    if (key === 'chat.modelMenu.refreshTimedOut') return 'Timed out';
    if (key === 'chat.modelMenu.refreshWithDiscovery') return `Discovered ${opts?.count}, added ${opts?.added}`;
    if (key === 'chat.modelMenu.refreshWithFailures') return `Errors: ${opts?.errors}`;
    if (key === 'chat.modelMenu.refreshFailed') return `Failed: ${opts?.error}`;
    return key;
  };

  it('returns up to date when successful with 0 discovered or added', () => {
    const res = formatModelRefreshSummary({ success: true, discoveredModels: 0, addedModels: 0 }, fakeT);
    expect(res).toEqual({ summary: 'Up to date', isError: false });
  });

  it('returns discovery counts when models were discovered', () => {
    const res = formatModelRefreshSummary({ success: true, discoveredModels: 12, addedModels: 3 }, fakeT);
    expect(res).toEqual({ summary: 'Discovered 12, added 3', isError: false });
  });

  it('appends errors to discovery counts when partial failures occur', () => {
    const res = formatModelRefreshSummary(
      { success: false, discoveredModels: 5, addedModels: 1, errors: ['provider-a: 401'] },
      fakeT,
    );
    expect(res.isError).toBe(false);
    expect(res.summary).toContain('Discovered 5, added 1');
    expect(res.summary).toContain('Errors: provider-a: 401');
  });

  it('returns error when refresh completely fails with errors', () => {
    const res = formatModelRefreshSummary({ success: false, errors: ['auth error', 'timeout'] }, fakeT);
    expect(res).toEqual({ summary: 'Errors: auth error; timeout', isError: true });
  });

  it('returns timeout message when aborted', () => {
    const res = formatModelRefreshSummary({ success: false, aborted: true }, fakeT);
    expect(res).toEqual({ summary: 'Timed out', isError: true });
  });
});
