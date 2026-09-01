// piSystem 服务：环境检测（带缓存）、最新版本查询、安装引导。
// 初次安装跟随 npm latest；fallback 只用于兼容失败后的恢复，不限制运行时最高版本。
import { spawn } from 'node:child_process';
import { PI_PACKAGE_NAME, getPiRegistryUrl } from '@shared/pi-compat';
import type {
  PiEnvironment,
  PiInstallResult,
  PiLatestVersionResult,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { detectPiEnvironment, invalidatePiDetectCache } from '../utils/pi-detector';
import { invalidatePiSdkCache } from '../utils/pi-loader';
import { inspectPiCompatibility } from './pi-adapter';
import { envWithUserPath } from '../utils/shell-env';

const DETECT_TTL_MS = 5 * 60 * 1000;
let detectCache: { at: number; env: PiEnvironment } | null = null;

export function invalidateDetectCache(): void {
  detectCache = null;
  invalidatePiDetectCache();
  invalidatePiSdkCache();
}

let installInFlight: Promise<PiInstallResult> | null = null;

export const piSystemApi = {
  detect: async (payload?: { force?: boolean }): Promise<PiEnvironment> => {
    if (!payload?.force && detectCache && Date.now() - detectCache.at < DETECT_TTL_MS) {
      return detectCache.env;
    }
    const env = detectPiEnvironment(payload?.force === true);
    detectCache = { at: Date.now(), env };
    // 兼容性报告需要加载 pi SDK（约 2-3s）：异步补齐后推送 envChanged，
    // 不阻塞启动/主界面（onboarding 状态只依赖基础检测，不需要 SDK）。
    if (env.pi.found && env.pi.packageRoot) {
      void inspectPiCompatibility()
        .then((compatibility) => {
          if (!compatibility) return;
          env.compatibility = compatibility;
          detectCache = { at: Date.now(), env };
          sendHostEvent('piSystem', 'envChanged', env);
        })
        .catch(() => {
          // 兼容性探测失败不阻塞：状态由基础检测决定
        });
    }
    return env;
  },

  checkLatest: async (): Promise<PiLatestVersionResult> => {
    const checkedAt = Date.now();
    try {
      const res = await fetch(getPiRegistryUrl(), {
        signal: AbortSignal.timeout(5000),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return { checkedAt };
      const data = (await res.json()) as { version?: string };
      return { latest: data.version, checkedAt };
    } catch {
      // 网络失败静默
      return { checkedAt };
    }
  },

  install: (): Promise<PiInstallResult> => {
    if (installInFlight) return installInFlight;
    installInFlight = new Promise<PiInstallResult>((resolvePromise) => {
      // 命令固定，参数固定——不接受任何外部输入拼接；无版本号明确安装 npm latest。
      // Windows 下 npm 是 npm.cmd，spawn 需要 shell 才能解析；为避免 args + shell
      // 组合触发 Node DEP0190 警告，Windows 下把命令与参数拼成单字符串传入
      // （均为固定常量，无注入面）。macOS/Linux 保持数组参数直接 spawn。
      const child =
        process.platform === 'win32'
          ? spawn(`npm i -g ${PI_PACKAGE_NAME}`, {
              env: envWithUserPath(),
              shell: true,
            })
          : spawn('npm', ['i', '-g', PI_PACKAGE_NAME], {
              env: envWithUserPath(),
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
      child.on('close', async (code) => {
        invalidateDetectCache();
        if (code === 0) {
          const env = detectPiEnvironment(true);
          const compatibility = env.pi.found ? await inspectPiCompatibility() : undefined;
          detectCache = { at: Date.now(), env: { ...env, compatibility } };
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
