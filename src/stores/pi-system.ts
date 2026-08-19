// pi 环境状态 store：检测结果、onboarding 场景、安装进度。
import { create } from 'zustand';
import type { PiEnvironment } from '@shared/host-api/contract';
import { computeOnboardingState, type OnboardingState } from '@shared/pi-status';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';

export type InstallPhase = 'idle' | 'running' | 'success' | 'failed';

type PiSystemState = {
  env: PiEnvironment | null;
  state: OnboardingState | null;
  checking: boolean;
  latestVersion?: string;
  installPhase: InstallPhase;
  installLog: string[];
  installError?: string;
  detect: (force?: boolean) => Promise<void>;
  install: () => Promise<void>;
  appendInstallLog: (text: string) => void;
};

const ENV_CACHE_KEY = 'pi-desktop.pi-environment';

type CachedEnvironment = { savedAt: number; env: PiEnvironment };

function readCachedEnvironment(): PiEnvironment | null {
  try {
    const raw = window.localStorage.getItem(ENV_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedEnvironment;
    return cached.env?.pi && cached.env?.node ? cached.env : null;
  } catch {
    return null;
  }
}

function saveCachedEnvironment(env: PiEnvironment): void {
  try {
    window.localStorage.setItem(ENV_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), env } satisfies CachedEnvironment));
  } catch {
    // 缓存不可用时不影响启动。
  }
}

const cachedEnvironment = readCachedEnvironment();

export const usePiSystemStore = create<PiSystemState>((set, get) => ({
  env: cachedEnvironment,
  state: cachedEnvironment ? computeOnboardingState(cachedEnvironment) : null,
  checking: false,
  installPhase: 'idle',
  installLog: [],

  detect: async (force) => {
    set({ checking: true });
    try {
      const env = await hostApi.piSystem.detect(force);
      saveCachedEnvironment(env);
      set({ env, state: computeOnboardingState(env), checking: false });
      // 不阻断的最新版本提示（失败静默）
      if (env.pi.found) {
        void hostApi.piSystem.checkLatest().then(({ latest }) => {
          if (latest) set({ latestVersion: latest });
        });
      }
    } catch {
      set({ checking: false });
    }
  },

  install: async () => {
    if (get().installPhase === 'running') return;
    set({ installPhase: 'running', installLog: [], installError: undefined });
    const result = await hostApi.piSystem.install();
    if (result.success) {
      set({ installPhase: 'success' });
      await get().detect(true);
      // 安装成功后仍未 ready（例如 PATH 遮蔽），回到对应场景页
      if (get().state === 'ready') return;
    } else {
      set({ installPhase: 'failed', installError: result.error });
    }
  },

  appendInstallLog: (text) => {
    set((s) => ({ installLog: [...s.installLog.slice(-500), text] }));
  },
}));

// 订阅 Main 推送的安装进度（模块级一次性绑定）
export function bindPiSystemEvents(): () => void {
  return onHostEvent('piSystem', 'installProgress', ({ text }) => {
    usePiSystemStore.getState().appendInstallLog(text);
  });
}
