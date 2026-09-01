// 窗口尺寸计算单测：小屏（800x600 远程桌面/虚拟机等 Windows 场景）贴屏不超界，
// 常规/大屏保持原有 1440x900 上限与 -64 边距行为不变。
import { describe, expect, it } from 'vitest';
import { computeRightExpansion, resolveMinSizeFor, resolveWindowSizeFor, shouldRestoreExpansion } from '../../electron/utils/window-bounds';

describe('resolveWindowSizeFor', () => {
  it('大屏（2560x1440）维持 1440x900 上限', () => {
    expect(resolveWindowSizeFor({ width: 2560, height: 1440 })).toEqual({ width: 1440, height: 900 });
  });

  it('常规笔记本（1366x768，workArea 减任务栏）维持原行为：-64 边距、960/640 下限', () => {
    expect(resolveWindowSizeFor({ width: 1366, height: 728 })).toEqual({ width: 1302, height: 664 });
  });

  it('小屏 800x600（workArea 800x552）：贴屏 -16，不超出 workArea', () => {
    const size = resolveWindowSizeFor({ width: 800, height: 552 });
    expect(size.width).toBeLessThanOrEqual(800);
    expect(size.height).toBeLessThanOrEqual(552);
    expect(size).toEqual({ width: 784, height: 536 });
  });

  it('极小屏 640x480：窗口不超出 workArea', () => {
    const size = resolveWindowSizeFor({ width: 640, height: 480 });
    expect(size.width).toBeLessThanOrEqual(640);
    expect(size.height).toBeLessThanOrEqual(480);
    expect(size).toEqual({ width: 624, height: 464 });
  });

  it('极端兜底：尺寸至少 ABSOLUTE_MIN，不为 0', () => {
    const size = resolveWindowSizeFor({ width: 300, height: 200 });
    expect(size.width).toBeGreaterThanOrEqual(320);
    expect(size.height).toBeGreaterThanOrEqual(320);
  });
});

describe('resolveMinSizeFor', () => {
  it('常规尺寸保持 960x640 硬下限', () => {
    expect(resolveMinSizeFor({ width: 1440, height: 900 })).toEqual({ width: 960, height: 640 });
  });

  it('小屏窗口随实际尺寸收紧，不把窗口撑出屏幕', () => {
    expect(resolveMinSizeFor({ width: 784, height: 536 })).toEqual({ width: 784, height: 536 });
  });
});

describe('computeRightExpansion', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1440 };

  it('右缘空间充足时按请求值加宽', () => {
    expect(computeRightExpansion({ x: 100, y: 40, width: 1200, height: 800 }, workArea, 656)).toBe(656);
  });

  it('右缘空间不足时 clamp 到可用空间', () => {
    // 右缘剩 2560 - (2000 + 400) = 160
    expect(computeRightExpansion({ x: 2000, y: 40, width: 400, height: 800 }, workArea, 656)).toBe(160);
  });

  it('已贴右缘时为 0', () => {
    expect(computeRightExpansion({ x: 1760, y: 40, width: 800, height: 800 }, workArea, 656)).toBe(0);
  });

  it('extraWidth ≤ 0 时为 0', () => {
    expect(computeRightExpansion({ x: 100, y: 40, width: 1200, height: 800 }, workArea, 0)).toBe(0);
    expect(computeRightExpansion({ x: 100, y: 40, width: 1200, height: 800 }, workArea, -50)).toBe(0);
  });

  it('workArea 有 x 偏移（副屏/左侧程序坞）时按偏移计算', () => {
    const secondary = { x: 2560, y: 0, width: 1920, height: 1080 };
    // 右缘 = 2560 + 1920 = 4480；窗口右缘 2560 + 100 + 1200 = 3860 → 可用 620
    expect(computeRightExpansion({ x: 2660, y: 40, width: 1200, height: 800 }, secondary, 700)).toBe(620);
  });
});

describe('shouldRestoreExpansion', () => {
  it('宽度仍是「原宽 + 加宽量」（容差内）时允许恢复', () => {
    expect(shouldRestoreExpansion(2096, 1440, 656)).toBe(true);
    expect(shouldRestoreExpansion(2096 + 8, 1440, 656)).toBe(true);
  });

  it('用户手动拖过宽度后放弃恢复', () => {
    expect(shouldRestoreExpansion(2096 + 100, 1440, 656)).toBe(false);
    expect(shouldRestoreExpansion(1440, 1440, 656)).toBe(false);
  });
});
