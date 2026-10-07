import type { PiProviderCatalogSource, PiProviderRefreshResult } from './host-api/contract';

export function determineCatalogSource(options: {
  source: 'builtin' | 'config' | 'extension';
  baseUrl?: string;
  isLmStudio?: boolean;
}): PiProviderCatalogSource {
  if (options.source === 'builtin' || options.source === 'extension') {
    return 'builtin-static';
  }
  if (options.isLmStudio || (options.baseUrl && options.baseUrl.trim().length > 0)) {
    return 'dynamic-discovery';
  }
  return 'custom-models-json';
}

export function formatModelRefreshSummary(
  result: PiProviderRefreshResult,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { summary: string; isError: boolean } {
  if (result.aborted) {
    return {
      summary: t('chat.modelMenu.refreshTimedOut'),
      isError: true,
    };
  }

  if (!result.success && result.errors && result.errors.length > 0 && !result.discoveredModels && !result.addedModels) {
    return {
      summary: t('chat.modelMenu.refreshWithFailures', { errors: result.errors.join('; ') }),
      isError: true,
    };
  }

  if (!result.success && result.error && !result.discoveredModels && !result.addedModels) {
    return {
      summary: t('chat.modelMenu.refreshFailed', { error: result.error }),
      isError: true,
    };
  }

  if (result.discoveredModels || result.addedModels) {
    let text = t('chat.modelMenu.refreshWithDiscovery', {
      count: result.discoveredModels ?? 0,
      added: result.addedModels ?? 0,
    });
    if (result.errors && result.errors.length > 0) {
      text += ` (${t('chat.modelMenu.refreshWithFailures', { errors: result.errors.join('; ') })})`;
    }
    return {
      summary: text,
      isError: false,
    };
  }

  if (result.errors && result.errors.length > 0) {
    return {
      summary: t('chat.modelMenu.refreshWithFailures', { errors: result.errors.join('; ') }),
      isError: false,
    };
  }

  return {
    summary: t('chat.modelMenu.refreshUpToDate'),
    isError: false,
  };
}
