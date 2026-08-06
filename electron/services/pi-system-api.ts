// piSystem 服务：环境检测（带缓存）、最新版本查询、安装引导。
// 安装命令有且仅有 npm i -g @earendil-works/pi-coding-agent（方案 B，docs §3）。
import { spawn } from 'node:child_process';
import { PI_NPM_REGISTRY_URL, PI_PACKAGE_NAME } from '@shared/pi-compat';
import type {
  PiEnvironment,
  PiInstallResult,
  PiLatestVersionResult,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { detectPiEnvironment } from '../utils/pi-detector';
import { envWithUserPath } from '../utils/shell-env';

const DETECT_TTL_MS = 5 * 60 * 1000;
let detectCache: { at: number; env: PiEnvironment } | null = null;

export function invalidateDetectCache(): void {
  detectCache = null;
}

let installInFlight: Promise<PiInstallResult> | null = null;

export const piSystemApi = {
  detect: (payload?: { force?: boolean }): PiEnvironment => {
    if (!payload?.force && detectCache && Date.now() - detectCache.at < DETECT_TTL_MS) {
      return detectCache.env;
    }
    const env = detectPiEnvironment();
    detectCache = { at: Date.now(), env };
    return env;
  },

  checkLatest: async (): Promise<PiLatestVersionResult> => {
    const checkedAt = Date.now();
    try {
      const res = await fetch(PI_NPM_REGISTRY_URL, {
        signal: AbortSignal.timeout(5000),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return { checkedAt };
      const data = (await res.json()) as { version?: string };
      return { latest: data.version, checkedAt };
    } catch {
      // 网络失败静默（docs §3：带超时与失败静默）
      return { checkedAt };
    }
  },

  install: (): Promise<PiInstallResult> => {
    if (installInFlight) return installInFlight;
    installInFlight = new Promise<PiInstallResult>((resolvePromise) => {
      // 命令固定，参数固定——不接受任何外部输入拼接
      const child = spawn('npm', ['i', '-g', PI_PACKAGE_NAME], {
        env: envWithUserPath(),
        shell: process.platform === 'win32',
      });
      let stderrTail = '';
      child.stdout.on('data', (chunk: Buffer) => {
        sendHostEvent('piSystem', 'installProgress', { stream: 'stdout', text: chunk.toString() });
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-2000);
        sendHostEvent('piSystem', 'installProgress', { stream: 'stderr', text });
      });
      child.on('error', (err) => {
        sendHostEvent('piSystem', 'installProgress', { stream: 'status', text: `error: ${err.message}` });
        resolvePromise({ success: false, error: err.message });
      });
      child.on('close', (code) => {
        invalidateDetectCache();
        if (code === 0) {
          const env = detectPiEnvironment();
          sendHostEvent('piSystem', 'installProgress', {
            stream: 'status',
            text: `done: pi ${env.pi.version ?? 'unknown'}`,
          });
          resolvePromise({ success: true, version: env.pi.version });
        } else {
          sendHostEvent('piSystem', 'installProgress', { stream: 'status', text: `exit code ${code}` });
          resolvePromise({ success: false, error: stderrTail || `npm exited with code ${code}` });
        }
      });
    }).finally(() => {
      installInFlight = null;
    });
    return installInFlight;
  },
};
