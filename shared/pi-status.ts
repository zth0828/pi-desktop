// onboarding 场景推导。兼容性不再按最高版本阻断，而是按能力报告决定。
import type { PiEnvironment } from './host-api/contract';

export type OnboardingState =
  | 'no-node'
  | 'no-pi'
  | 'non-npm'
  | 'pi-outdated'
  | 'pi-incompatible'
  | 'ready';

export function computeOnboardingState(env: PiEnvironment): OnboardingState {
  if (!env.node.found || !env.node.meetsMin || !env.npm.found) return 'no-node';
  if (!env.pi.found) return 'no-pi';
  if (env.pi.installKind !== 'npm' && !env.pi.devOverride) return 'non-npm';
  if (!env.pi.meetsMin && !(env.pi.devOverride && env.pi.devAllowsOutdated)) return 'pi-outdated';
  if (env.compatibility?.status === 'incompatible') return 'pi-incompatible';
  return 'ready';
}
