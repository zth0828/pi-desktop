// 窗口内拖放标记（多面板 P3）：分栏落区 drop 成功后置位，SessionList 行的 dragend
// 读取后清除，据此抑制 OS 级 openDetachedAt 上报（窗口外松手仍走 v1 独立窗口，两能力共存）。
// dragPayload 是 SessionList 组件内 ref，落区拿不到，故用模块单例桥接。
let droppedInWindow = false;

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
