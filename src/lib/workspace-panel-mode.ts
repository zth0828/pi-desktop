export type WorkspacePanelModePreference = 'auto' | 'docked' | 'overlay';
export type WorkspacePanelEffectiveMode = 'docked' | 'overlay';

export const WORKSPACE_PANEL_MODE_KEY = 'pi-desktop.workspace-panel-mode';
export const PANEL_WIDTH_STORAGE_KEY = 'pi-desktop.workspace-panel-width';

/** 聊天列舒适阅读宽度：容器够宽时先保住它，剩余空间才给面板 */
export const CHAT_COLUMN_COMFORT = 640;
/** 聊天列可被挤压到的下限；容器连它也保不住时 docked 回退 overlay */
export const CHAT_COLUMN_MIN = 480;
/** 面板拖拽/显示的下限宽度 */
export const WORKSPACE_PANEL_MIN = 360;
/** docked 面板的最小可用宽度：低于它面板被压成细条，显式 docked 也回退 overlay */
export const DOCKED_PANEL_FLOOR = WORKSPACE_PANEL_MIN;
/** 面板默认宽上限：文件/评审共用同一公式，仅上限不同（评审 diff 需要更多横向空间） */
export const PANEL_WIDTH_CAP_FILES = 840;
export const PANEL_WIDTH_CAP_REVIEW = 920;

/**
 * 面板默认宽的唯一公式（文件/评审共用）：
 * - docked：容器先给聊天列留舒适宽，剩余给面板，夹在 [DOCKED_PANEL_FLOOR, cap] 之间；
 *   窗口再宽面板也不超过 cap，余量归聊天列。
 * - overlay：悬浮在聊天列之上，无需给聊天列留宽，只留一条边缝。
 */
export function resolveDefaultPanelWidth(
  containerWidth: number,
  tab: 'files' | 'review',
  mode: WorkspacePanelEffectiveMode = 'docked',
): number {
  const cap = tab === 'review' ? PANEL_WIDTH_CAP_REVIEW : PANEL_WIDTH_CAP_FILES;
  if (mode === 'overlay') {
    return Math.min(Math.max(containerWidth - 48, WORKSPACE_PANEL_MIN), cap);
  }
  return Math.min(Math.max(containerWidth - CHAT_COLUMN_COMFORT, DOCKED_PANEL_FLOOR), cap);
}

export function resolveEffectiveMode(
  preference: WorkspacePanelModePreference,
  containerWidth: number,
): WorkspacePanelEffectiveMode {
  if (preference === 'overlay') return 'overlay';
  return containerWidth >= CHAT_COLUMN_MIN + DOCKED_PANEL_FLOOR ? 'docked' : 'overlay';
}

export function clampPanelWidth(
  width: number,
  containerWidth: number,
  mode: WorkspacePanelEffectiveMode = 'docked',
): number {
  if (mode === 'overlay') {
    const maximum = Math.max(WORKSPACE_PANEL_MIN, containerWidth);
    const minimum = Math.min(WORKSPACE_PANEL_MIN, maximum);
    return Math.min(maximum, Math.max(minimum, width));
  }
  const maximum = Math.max(DOCKED_PANEL_FLOOR, containerWidth - CHAT_COLUMN_MIN);
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
