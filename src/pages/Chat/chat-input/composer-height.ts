/**
 * 纯函数：根据当前是否有内容、滚动高度与视口高度计算编辑器内联样式高度与滚动条状态
 */
export function computeComposerHeight(
  hasContent: boolean,
  scrollHeight: number,
  windowInnerHeight: number,
): { heightStyle: string; scrollable: boolean } {
  if (!hasContent) {
    return { heightStyle: '', scrollable: false };
  }
  const maximum = Math.max(112, Math.min(260, Math.round(windowInnerHeight * 0.32)));
  const nextHeight = Math.max(56, Math.min(scrollHeight, maximum));
  const scrollable = scrollHeight > maximum + 1;
  return { heightStyle: `${nextHeight}px`, scrollable };
}
