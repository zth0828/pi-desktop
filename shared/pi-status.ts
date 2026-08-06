// onboarding 五场景推导（docs/TECHNICAL-PLAN.md §3）。纯函数，单测覆盖。
import type { PiEnvironment } from './host-api/contract';

export type OnboardingState =
  | 'no-node' // 未检测到 Node/npm，或 Node 版本过低（合并为一个引导页）
  | 'no-pi' // Node 就绪但未装 pi → 安装引导
  | 'non-npm' // PATH 里的 pi 是 install.sh/bun 安装的 → 一键切换 npm 版
  | 'pi-outdated' // npm 版 pi 但版本低于 minPiVersion → 阻断升级
  | 'ready';

export function computeOnboardingState(env: PiEnvironment): OnboardingState {
  if (!env.node.found || !env.node.meetsMin || !env.npm.found) return 'no-node';
  if (!env.pi.found) return 'no-pi';
  if (env.pi.installKind !== 'npm') return 'non-npm';
  if (!env.pi.meetsMin) return 'pi-outdated';
  return 'ready';
}
