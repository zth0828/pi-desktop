import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  getNextModePreference,
  resolveEffectiveMode,
  CHAT_COLUMN_COMFORT,
  CHAT_COLUMN_MIN,
  WORKSPACE_PANEL_MIN,
} from '@/lib/workspace-panel-mode';

describe('resolveEffectiveMode', () => {
  it('explicit docked preference returns docked when minimums fit', () => {
    expect(resolveEffectiveMode('docked', 1600, 760)).toBe('docked');
    // 恰好在下限：560 聊天列 + 320 面板 = 880
    expect(resolveEffectiveMode('docked', CHAT_COLUMN_MIN + 320, 760)).toBe('docked');
  });

  it('explicit docked falls back to overlay when container cannot fit chat minimum plus panel floor', () => {
    expect(resolveEffectiveMode('docked', CHAT_COLUMN_MIN + 320 - 1, 760)).toBe('overlay');
    expect(resolveEffectiveMode('docked', 500, 760)).toBe('overlay');
  });

  it('explicit overlay preference returns overlay', () => {
    expect(resolveEffectiveMode('overlay', 500, 760)).toBe('overlay');
    expect(resolveEffectiveMode('overlay', 1600, 760)).toBe('overlay');
  });

  it('auto mode chooses docked when container has enough space for comfort chat column and panel', () => {
    const expectedPanel = 760;
    const threshold = CHAT_COLUMN_COMFORT + expectedPanel; // 640 + 760 = 1400
    expect(resolveEffectiveMode('auto', threshold, expectedPanel)).toBe('docked');
    expect(resolveEffectiveMode('auto', threshold + 100, expectedPanel)).toBe('docked');
  });

  it('auto mode chooses overlay when container width is below threshold', () => {
    const expectedPanel = 760;
    const threshold = CHAT_COLUMN_COMFORT + expectedPanel; // 1400
    expect(resolveEffectiveMode('auto', threshold - 1, expectedPanel)).toBe('overlay');
    expect(resolveEffectiveMode('auto', 1000, expectedPanel)).toBe('overlay');
    expect(resolveEffectiveMode('auto', 600, expectedPanel)).toBe('overlay');
  });
});

describe('clampPanelWidth', () => {
  it('docked mode preserves chat column minimum width', () => {
    const containerWidth = 1200;
    // max = 1200 - 560 = 640. min = min(620, 640) = 620.
    expect(clampPanelWidth(760, containerWidth, 'docked')).toBe(640);
    expect(clampPanelWidth(500, containerWidth, 'docked')).toBe(620);
  });

  it('docked mode clamps to minimum when container is tight', () => {
    const containerWidth = 800;
    // max = 800 - 560 = 240 -> clamped to Math.max(320, 240) = 320.
    // min = min(620, 320) = 320.
    expect(clampPanelWidth(600, containerWidth, 'docked')).toBe(320);
  });

  it('overlay mode allows width up to full container width without chat column constraint', () => {
    const containerWidth = 1000;
    // max = 1000. min = min(620, 1000) = 620.
    expect(clampPanelWidth(760, containerWidth, 'overlay')).toBe(760);
    expect(clampPanelWidth(900, containerWidth, 'overlay')).toBe(900);
    expect(clampPanelWidth(1200, containerWidth, 'overlay')).toBe(1000);
    expect(clampPanelWidth(500, containerWidth, 'overlay')).toBe(620);
  });

  it('overlay mode clamps to container width if container is smaller than min panel width', () => {
    const containerWidth = 450;
    // max = 450. min = 450.
    expect(clampPanelWidth(760, containerWidth, 'overlay')).toBe(450);
  });
});

describe('getNextModePreference', () => {
  it('cycles auto -> docked -> overlay -> auto', () => {
    expect(getNextModePreference('auto')).toBe('docked');
    expect(getNextModePreference('docked')).toBe('overlay');
    expect(getNextModePreference('overlay')).toBe('auto');
  });
});
