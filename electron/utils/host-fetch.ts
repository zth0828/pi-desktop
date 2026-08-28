import { fetch as undiciFetch, ProxyAgent } from 'undici';
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
export async function hostFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  // Request 对象自带最终 URL（URL 对象转 href），仅用于豁免判断，转发时原样传递
  const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (shouldBypassProxy(target)) {
    return fetch(url, init);
  }

  const resolved = await resolveProxy().catch(() => ({ source: 'off' as const }));
  if ('url' in resolved && resolved.url && resolved.source === 'app') {
    // dispatcher 必须与 fetch 来自同一个 undici 实例：Node 内置的全局 fetch
    // 不认项目 undici 包构造的 ProxyAgent（UND_ERR_INVALID_ARG），代理分支
    // 必须用 undici 包自己的 fetch 才能真正走代理。
    const dispatcher = new ProxyAgent(resolved.url);
    try {
      return (await undiciFetch(
        url as Parameters<typeof undiciFetch>[0],
        { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
      )) as unknown as Response;
    } catch {
      // 本地代理未启动（ECONNREFUSED / 连接超时等）时降级为直连，避免阻塞业务
      return fetch(url, init);
    }
  }
  return fetch(url, init);
}
