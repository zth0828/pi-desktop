/**
 * 导航 rail 悬浮提示文本截断，避免长文本撑高/撑宽浮层遮挡内容。
 */
export function truncateRailText(text: string, max = 120): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
