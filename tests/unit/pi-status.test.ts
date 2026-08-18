import { describe, expect, it } from 'vitest';
import type { PiEnvironment } from '@shared/host-api/contract';
import { computeOnboardingState } from '@shared/pi-status';

function env(overrides: {
  node?: Partial<PiEnvironment['node']>;
  npm?: Partial<PiEnvironment['npm']>;
  pi?: Partial<PiEnvironment['pi']>;
  compatibility?: PiEnvironment['compatibility'];
}): PiEnvironment {
  return {
    node: { found: true, version: '24.14.0', meetsMin: true, ...overrides.node },
    npm: { found: true, version: '11.9.0', ...overrides.npm },
    pi: { found: true, version: '0.83.0', installKind: 'npm', meetsMin: true, ...overrides.pi },
    minNodeVersion: '22.19.0',
    minPiVersion: '0.83.0',
    compatibility: overrides.compatibility,
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

  it('未来版本能力完整时不阻断，缺少必要能力时才进入 incompatible', () => {
    const base: Omit<NonNullable<PiEnvironment['compatibility']>, 'status'> = {
      version: '0.85.0',
      packageRoot: '/tmp/pi',
      cliPath: '/tmp/pi/bin/pi',
      missingRequiredCapabilities: [],
      optionalCapabilities: {},
      capabilities: {
        createAgentSessionServices: true,
        createAgentSessionFromServices: true,
        createAgentSessionRuntime: true,
        sessionManager: true,
        settingsManager: true,
        eventBus: true,
        prompt: true,
        subscribe: true,
        abort: true,
      },
      testedRange: false,
      recommendedVersion: '0.84.2',
      warnings: [],
    };
    expect(computeOnboardingState(env({ compatibility: { ...base, status: 'compatible-untested' } }))).toBe('ready');
    expect(computeOnboardingState(env({
      compatibility: {
        ...base,
        status: 'incompatible',
        missingRequiredCapabilities: ['createAgentSessionRuntime'],
      },
    }))).toBe('pi-incompatible');
  });

  it('dev override 允许使用达标的非 npm pi', () => {
    expect(computeOnboardingState(env({
      pi: { installKind: 'non-npm', devOverride: true },
    }))).toBe('ready');
  });

  it('dev override 默认仍阻止过低版本', () => {
    expect(computeOnboardingState(env({
      pi: { version: '0.82.1', installKind: 'non-npm', meetsMin: false, devOverride: true },
    }))).toBe('pi-outdated');
  });

  it('dev override 只有显式 unsafe 时才允许过低版本', () => {
    expect(computeOnboardingState(env({
      pi: {
        version: '0.82.1',
        installKind: 'non-npm',
        meetsMin: false,
        devOverride: true,
        devAllowsOutdated: true,
      },
    }))).toBe('ready');
  });
});
