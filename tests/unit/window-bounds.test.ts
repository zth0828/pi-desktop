// 窗口尺寸计算单测：小屏（800x600 远程桌面/虚拟机等 Windows 场景）贴屏不超界，
// 常规/大屏保持原有 1440x900 上限与 -64 边距行为不变。
import { describe, expect, it } from 'vitest';
import { resolveMinSizeFor, resolveWindowSizeFor } from '../../electron/utils/window-bounds';

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
