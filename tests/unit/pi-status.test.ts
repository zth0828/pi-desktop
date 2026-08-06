import { describe, expect, it } from 'vitest';
import type { PiEnvironment } from '@shared/host-api/contract';
import { computeOnboardingState } from '@shared/pi-status';

function env(overrides: {
  node?: Partial<PiEnvironment['node']>;
  npm?: Partial<PiEnvironment['npm']>;
  pi?: Partial<PiEnvironment['pi']>;
}): PiEnvironment {
  return {
    node: { found: true, version: '24.14.0', meetsMin: true, ...overrides.node },
    npm: { found: true, version: '11.9.0', ...overrides.npm },
    pi: { found: true, version: '0.83.0', installKind: 'npm', meetsMin: true, ...overrides.pi },
    minNodeVersion: '22.19.0',
    minPiVersion: '0.83.0',
  };
}

describe('computeOnboardingState — onboarding 五场景', () => {
  it('无 Node → no-node', () => {
    expect(computeOnboardingState(env({ node: { found: false, meetsMin: false } }))).toBe('no-node');
  });

  it('Node 版本过低 → no-node（与缺失合并为一个引导页）', () => {
    expect(computeOnboardingState(env({ node: { version: '20.0.0', meetsMin: false } }))).toBe('no-node');
  });

  it('有 Node 无 npm → no-node', () => {
    expect(computeOnboardingState(env({ npm: { found: false } }))).toBe('no-node');
  });

  it('Node 就绪无 pi → no-pi', () => {
    expect(computeOnboardingState(env({ pi: { found: false, meetsMin: false, installKind: undefined } }))).toBe('no-pi');
  });

  it('bun/install.sh 安装 → non-npm', () => {
    expect(computeOnboardingState(env({ pi: { installKind: 'non-npm' } }))).toBe('non-npm');
  });

  it('npm 安装但版本过低 → pi-outdated', () => {
    expect(computeOnboardingState(env({ pi: { version: '0.82.1', meetsMin: false } }))).toBe('pi-outdated');
  });

  it('npm 安装且版本达标 → ready', () => {
    expect(computeOnboardingState(env({}))).toBe('ready');
  });
});
