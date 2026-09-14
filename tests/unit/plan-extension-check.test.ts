import { describe, expect, it } from 'vitest';
import { isPlanExtensionInstalled } from '../../src/pages/Chat/chat-input/plan-extension-check';
import type { PiPackageRow } from '@shared/host-api/contract';

describe('plan-extension-check (计划模式扩展检测)', () => {
  it('当列表中包含 @narumitw/pi-plan-mode 时判定已安装', () => {
    const packages: PiPackageRow[] = [
      {
        name: '@narumitw/pi-plan-mode',
        source: 'npm:@narumitw/pi-plan-mode',
        scope: 'user',
        filtered: false,
      },
    ];
    expect(isPlanExtensionInstalled(packages)).toBe(true);
  });

  it('当列表中包含其他 plan 变种包时判定已安装', () => {
    const packages1: PiPackageRow[] = [
      {
        name: 'pi-plan',
        source: 'npm:pi-plan',
        scope: 'user',
        filtered: false,
      },
    ];
    expect(isPlanExtensionInstalled(packages1)).toBe(true);

    const packages2: PiPackageRow[] = [
      {
        name: 'pi-modes',
        source: 'npm:@sion10032/pi-modes',
        scope: 'user',
        filtered: false,
      },
    ];
    expect(isPlanExtensionInstalled(packages2)).toBe(true);
  });

  it('当会话内已有活跃状态或组件时判定已生效', () => {
    expect(isPlanExtensionInstalled([], true)).toBe(true);
    expect(isPlanExtensionInstalled([], false, true)).toBe(true);
  });

  it('当包列表为空或未安装 plan 相关包时判定未安装', () => {
    const packages: PiPackageRow[] = [
      {
        name: 'ask-question',
        source: 'npm:ask-question',
        scope: 'user',
        filtered: false,
      },
    ];
    expect(isPlanExtensionInstalled(packages, false, false)).toBe(false);
    expect(isPlanExtensionInstalled([])).toBe(false);
  });
});
