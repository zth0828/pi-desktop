// 窗口尺寸计算（纯函数，不依赖 electron，方便单测；window-manager 组装 screen 调用）。
// 大屏保持 1440x900 上限与 -64 边距；workArea 本身不足 960x640（800x600 远程桌面、
// 老设备、小分辨率虚拟机，Windows 上真实场景）时贴屏 -16，避免窗口超出屏幕、
// 既拖不动也看不到全貌。min 尺寸随实际窗口收紧，避免硬下限把窗口撑出屏幕。
export type WindowSize = { width: number; height: number };
export type WindowBounds = { x: number; y: number; width: number; height: number };
export type WorkArea = { x: number; y: number; width: number; height: number };

const MAX_WIDTH = 1440;
const MAX_HEIGHT = 900;
const EDGE_MARGIN = 64; // 常规边距（workArea 两侧各留一点）
const TIGHT_MARGIN = 16; // 小屏贴屏边距
const MIN_WIDTH = 960; // 侧栏 + 聊天列(420) + 右侧面板的最小可用宽度；窄于此面板转覆盖层
const MIN_HEIGHT = 640;
const ABSOLUTE_MIN = 320; // 极端兜底（不至于退化为 0 尺寸窗口）

export function resolveWindowSizeFor(workArea: WindowSize): WindowSize {
  const width = workArea.width - EDGE_MARGIN >= MIN_WIDTH
    ? Math.min(MAX_WIDTH, workArea.width - EDGE_MARGIN)
    : Math.max(ABSOLUTE_MIN, workArea.width - TIGHT_MARGIN);
  const height = workArea.height - EDGE_MARGIN >= MIN_HEIGHT
    ? Math.min(MAX_HEIGHT, workArea.height - EDGE_MARGIN)
    : Math.max(ABSOLUTE_MIN, workArea.height - TIGHT_MARGIN);
  return { width, height };
}

/** minWidth/minHeight 随实际窗口尺寸收紧，保证小屏上窗口可以完整显示并自由缩放。 */
export function resolveMinSizeFor(size: WindowSize): WindowSize {
  return {
    width: Math.min(MIN_WIDTH, size.width),
    height: Math.min(MIN_HEIGHT, size.height),
  };
}

/** 窗口向右加宽的可用量：不超过所在显示器 workArea 右缘；extraWidth ≤ 0 或右缘无空间时为 0。 */
export function computeRightExpansion(bounds: WindowBounds, workArea: WorkArea, extraWidth: number): number {
  const available = Math.max(0, workArea.x + workArea.width - (bounds.x + bounds.width));
  return Math.min(Math.max(0, Math.round(extraWidth)), available);
}

/** 展开后能否对称缩回：宽度仍是「原宽 + 加宽量」（±8px 容差）才恢复，否则视为用户手动改过尺寸。 */
export function shouldRestoreExpansion(currentWidth: number, originalWidth: number, applied: number): boolean {
  return Math.abs(currentWidth - (originalWidth + applied)) <= 8;
}
