// 会话行拖出开窗的几何判定。
// 纯函数不依赖 electron（方便单测）；window-manager.createSessionWindowAtPoint 组装调用。
// 坐标系：渲染层 dragend 的 screenX/screenY 与 Electron screen 模块同为屏幕 DIP、左上原点。

export type DetachPoint = { x: number; y: number };
export type DetachRect = { x: number; y: number; width: number; height: number };

/** 落点是否落在任一矩形内（右/下边界不算在内，与屏幕 bounds 语义一致）。 */
export function isPointInsideRects(point: DetachPoint, rects: DetachRect[]): boolean {
  return rects.some(
    (rect) =>
      point.x >= rect.x &&
      point.x < rect.x + rect.width &&
      point.y >= rect.y &&
      point.y < rect.y + rect.height,
  );
}

/** 以落点为窗口中心计算 bounds，并 clamp 到 workArea 内（窗口比 workArea 大时贴左上）。 */
export function centerBoundsAtPoint(
  point: DetachPoint,
  size: { width: number; height: number },
  workArea: DetachRect,
): DetachRect {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: clamp(Math.round(point.x - size.width / 2), workArea.x, maxX),
    y: clamp(Math.round(point.y - size.height / 2), workArea.y, maxY),
    width: size.width,
    height: size.height,
  };
}
