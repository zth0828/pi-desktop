import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  getNextModePreference,
  resolveDefaultPanelWidth,
  resolveEffectiveMode,
  CHAT_COLUMN_COMFORT,
  CHAT_COLUMN_MIN,
  DOCKED_PANEL_FLOOR,
  PANEL_WIDTH_CAP_FILES,
  PANEL_WIDTH_CAP_REVIEW,
  WORKSPACE_PANEL_MIN,
} from '@/lib/workspace-panel-mode';

describe('resolveEffectiveMode', () => {
  it('explicit docked preference returns docked when minimums fit', () => {
    expect(resolveEffectiveMode('docked', 1600)).toBe('docked');
    // 恰好在下限：聊天列下限 + 面板下限
    expect(resolveEffectiveMode('docked', CHAT_COLUMN_MIN + DOCKED_PANEL_FLOOR)).toBe('docked');
  });

  it('explicit docked falls back to overlay when container cannot fit chat minimum plus panel floor', () => {
    expect(resolveEffectiveMode('docked', CHAT_COLUMN_MIN + DOCKED_PANEL_FLOOR - 1)).toBe('overlay');
    expect(resolveEffectiveMode('docked', 500)).toBe('overlay');
  });

  it('explicit overlay preference returns overlay', () => {
    expect(resolveEffectiveMode('overlay', 500)).toBe('overlay');
    expect(resolveEffectiveMode('overlay', 1600)).toBe('overlay');
  });

  it('auto mode chooses docked by default when minimums fit', () => {
    expect(resolveEffectiveMode('auto', 1600)).toBe('docked');
    expect(resolveEffectiveMode('auto', 1000)).toBe('docked');
  });

  it('auto mode falls back to overlay when container cannot fit chat minimum plus panel floor', () => {
    expect(resolveEffectiveMode('auto', CHAT_COLUMN_MIN + DOCKED_PANEL_FLOOR - 1)).toBe('overlay');
    expect(resolveEffectiveMode('auto', 500)).toBe('overlay');
  });
});

describe('resolveDefaultPanelWidth', () => {
  it('leaves chat comfort width to the chat column and gives the rest to the panel', () => {
    expect(resolveDefaultPanelWidth(1216, 'review')).toBe(1216 - CHAT_COLUMN_COMFORT);
    expect(resolveDefaultPanelWidth(1216, 'files')).toBe(1216 - CHAT_COLUMN_COMFORT);
  });

  it('caps panel width so extra-wide windows benefit the chat column', () => {
    expect(resolveDefaultPanelWidth(2336, 'review')).toBe(PANEL_WIDTH_CAP_REVIEW);
    expect(resolveDefaultPanelWidth(2336, 'files')).toBe(PANEL_WIDTH_CAP_FILES);
    expect(resolveDefaultPanelWidth(1576, 'review')).toBe(PANEL_WIDTH_CAP_REVIEW);
    expect(resolveDefaultPanelWidth(1576, 'files')).toBe(PANEL_WIDTH_CAP_FILES);
  });

  it('never goes below the panel floor even in narrow containers', () => {
    expect(resolveDefaultPanelWidth(500, 'review')).toBe(DOCKED_PANEL_FLOOR);
    expect(resolveDefaultPanelWidth(0, 'files')).toBe(DOCKED_PANEL_FLOOR);
  });

  it('overlay mode does not reserve chat width, only a small edge gap', () => {
    // overlay 悬浮在聊天列之上：容器 536 时默认 488（旧版 CSS 百分比下约 536）
    expect(resolveDefaultPanelWidth(536, 'files', 'overlay')).toBe(536 - 48);
    expect(resolveDefaultPanelWidth(2336, 'review', 'overlay')).toBe(PANEL_WIDTH_CAP_REVIEW);
    expect(resolveDefaultPanelWidth(300, 'files', 'overlay')).toBe(WORKSPACE_PANEL_MIN);
  });
});

describe('clampPanelWidth', () => {
  it('docked mode preserves chat column minimum width', () => {
    const containerWidth = 1200;
    // max = 1200 - 480 = 720. min = min(360, 720) = 360.
    expect(clampPanelWidth(700, containerWidth, 'docked')).toBe(700);
    expect(clampPanelWidth(900, containerWidth, 'docked')).toBe(720);
    expect(clampPanelWidth(300, containerWidth, 'docked')).toBe(WORKSPACE_PANEL_MIN);
  });

  it('docked mode clamps to minimum when container is tight', () => {
    const containerWidth = 800;
    // max = max(360, 800 - 480) = 360（下限托底）。min = min(360, 360) = 360.
    expect(clampPanelWidth(600, containerWidth, 'docked')).toBe(360);
  });

  it('overlay mode allows width up to full container width without chat column constraint', () => {
    const containerWidth = 1000;
    // max = 1000. min = min(360, 1000) = 360.
    expect(clampPanelWidth(760, containerWidth, 'overlay')).toBe(760);
    expect(clampPanelWidth(900, containerWidth, 'overlay')).toBe(900);
    expect(clampPanelWidth(1200, containerWidth, 'overlay')).toBe(1000);
    expect(clampPanelWidth(300, containerWidth, 'overlay')).toBe(WORKSPACE_PANEL_MIN);
  });

  it('overlay mode keeps at least the panel floor even if container is smaller', () => {
    // CSS 侧另有 min(var, 100%) 兜底，这里只保证公式不产出低于下限的值
    expect(clampPanelWidth(760, 300, 'overlay')).toBe(WORKSPACE_PANEL_MIN);
  });
});

describe('getNextModePreference', () => {
  it('cycles auto -> docked -> overlay -> auto', () => {
    expect(getNextModePreference('auto')).toBe('docked');
    expect(getNextModePreference('docked')).toBe('overlay');
    expect(getNextModePreference('overlay')).toBe('auto');
  });
});
