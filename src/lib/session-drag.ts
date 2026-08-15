// 窗口内拖放标记：分栏落区 drop 成功后置位，SessionList 行的 dragend
// 读取后清除，据此抑制 OS 级 openDetachedAt 上报（窗口外松手仍走独立窗口，两能力共存）。
// Esc 取消标记：macOS 上 Esc 取消时 dragend 坐标是取消点而非 (0,0)，坐标启发式接不住
// （窗口外按 Esc 会误开窗）；dragstart 后挂 keydown 监听，Esc 置位，dragend 读取后抑制上报。
// dragPayload 是 SessionList 组件内 ref，落区拿不到，故用模块单例桥接。
let droppedInWindow = false;
let dragCancelled = false;

/** 分栏落区 drop 成功（含同会话无操作）后调用 */
export function markSessionDroppedInWindow(): void {
  droppedInWindow = true;
}

/** dragstart 时复位，防止上一次未配对的标记误抑制本次 dragend */
export function resetSessionDroppedInWindow(): void {
  droppedInWindow = false;
}

/** SessionList dragend 读取（读后即清）：true = 本次拖拽已在窗口内消化，不再上报 OS 开窗 */
export function consumeSessionDroppedInWindow(): boolean {
  const value = droppedInWindow;
  droppedInWindow = false;
  return value;
}

/** 拖拽进行中按下 Esc（SessionList 在 dragstart 挂的 keydown 监听调用） */
export function markSessionDragCancelled(): void {
  dragCancelled = true;
}

/** dragstart 时复位 */
export function resetSessionDragCancelled(): void {
  dragCancelled = false;
}

/** dragend 读取（读后即清）：true = 本次拖拽被 Esc 取消，不上报 OS 开窗 */
export function consumeSessionDragCancelled(): boolean {
  const value = dragCancelled;
  dragCancelled = false;
  return value;
}
