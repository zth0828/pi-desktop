// 系统代理检测：先读 macOS 系统代理设置（Clash 等开"系统代理"时写入），
// 再回退探测常见本地代理端口。pi 的全局网络栈用 undici EnvHttpProxyAgent，
// 只认 HTTP_PROXY/HTTPS_PROXY 环境变量，不读系统代理；这里把系统代理转成
// 可喂给 pi 的 URL。
import { execFileSync } from 'node:child_process';
import net from 'node:net';

export type SystemProxyInfo = {
  url: string;
  source: 'system' | 'probe';
};

// Clash Verge / ClashX / V2rayU / Surge 等常见本地代理端口。
const COMMON_PROXY_PORTS = [7897, 7890, 1087, 8888, 1080, 6152, 33210];

function probePort(port: number, timeoutMs = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: timeoutMs });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

function readMacSystemProxy(): SystemProxyInfo | null {
  try {
    const out = execFileSync('/usr/sbin/scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const host = /HTTPSProxy\s*:\s*(\S+)/.exec(out)?.[1];
    const portText = /HTTPSPort\s*:\s*(\d+)/.exec(out)?.[1];
    const enabled = /HTTPSEnable\s*:\s*(?:1|true)/i.test(out);
    if (!enabled || !host || !portText) return null;
    const port = Number(portText);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
    return { url: `http://${host}:${port}`, source: 'system' };
  } catch {
    return null; // 非 macOS 或 scutil 不可用
  }
}

export async function detectSystemProxy(): Promise<SystemProxyInfo | null> {
  const system = readMacSystemProxy();
  if (system && await probePort(Number(new URL(system.url).port), 500)) return system;
  for (const port of COMMON_PROXY_PORTS) {
    if (await probePort(port, 250)) return { url: `http://127.0.0.1:${port}`, source: 'probe' };
  }
  return null;
}
