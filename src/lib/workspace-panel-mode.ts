export type WorkspacePanelModePreference = 'auto' | 'docked' | 'overlay';
export type WorkspacePanelEffectiveMode = 'docked' | 'overlay';

export const WORKSPACE_PANEL_MODE_KEY = 'pi-desktop.workspace-panel-mode';
export const PANEL_WIDTH_STORAGE_KEY = 'pi-desktop.workspace-panel-width';

export const WORKSPACE_PANEL_MIN = 620;
export const CHAT_COLUMN_COMFORT = 640;
export const CHAT_COLUMN_MIN = 560;
export const DEFAULT_PANEL_WIDTH_FILES = 760;
export const DEFAULT_PANEL_WIDTH_REVIEW = 820;

export function resolveEffectiveMode(
  preference: WorkspacePanelModePreference,
  containerWidth: number,
  expectedPanelWidth: number,
): WorkspacePanelEffectiveMode {
  if (preference === 'docked') return 'docked';
  if (preference === 'overlay') return 'overlay';
  return containerWidth >= CHAT_COLUMN_COMFORT + expectedPanelWidth ? 'docked' : 'overlay';
}

export function clampPanelWidth(
  width: number,
  containerWidth: number,
  mode: WorkspacePanelEffectiveMode = 'docked',
): number {
  if (mode === 'overlay') {
    const maximum = Math.max(320, containerWidth);
    const minimum = Math.min(WORKSPACE_PANEL_MIN, maximum);
    return Math.min(maximum, Math.max(minimum, width));
  }
  const maximum = Math.max(320, containerWidth - CHAT_COLUMN_MIN);
  const minimum = Math.min(WORKSPACE_PANEL_MIN, maximum);
  return Math.min(maximum, Math.max(minimum, width));
}

export function getNextModePreference(
  current: WorkspacePanelModePreference,
): WorkspacePanelModePreference {
  if (current === 'auto') return 'docked';
  if (current === 'docked') return 'overlay';
  return 'auto';
}
