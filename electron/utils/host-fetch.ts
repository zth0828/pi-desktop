import { ProxyAgent } from 'undici';
import { resolveProxy } from '../services/proxy-api';

function shouldBypassProxy(targetUrl: string | URL): boolean {
  try {
    const parsed = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
      return true;
    }
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
    if (noProxy) {
      const parts = noProxy.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
      if (parts.some((part) => part === '*' || hostname === part || hostname.endsWith(`.${part}`))) {
        return true;
      }
    }
  } catch {
    // URL 解析失败时走默认流程
  }
  return false;
}

/**
 * 封装支持应用内代理配置的 fetch。
 * 当应用设置中开启代理时，使用 undici ProxyAgent；关闭或未配置时回退到默认直连。
 * 本地回环地址和 NO_PROXY 豁免地址始终直连，不转发到代理。
 */
export async function hostFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  if (shouldBypassProxy(url)) {
    return fetch(url, init);
  }

  const resolved = await resolveProxy().catch(() => ({ source: 'off' as const }));
  if ('url' in resolved && resolved.url && resolved.source === 'app') {
    const dispatcher = new ProxyAgent(resolved.url);
    const customFetch = fetch as unknown as (
      targetUrl: string | URL,
      options?: RequestInit & { dispatcher?: unknown },
    ) => Promise<Response>;
    return customFetch(url, {
      ...init,
      dispatcher,
    });
  }
  return fetch(url, init);
}
