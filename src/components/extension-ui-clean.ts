/**
 * 清理选项文本中已自带的数字序号前缀（如 '1. ' 或 '1、'），避免与徽标重复
 */
export function cleanOptionText(text: string): string {
  return text.replace(/^\s*\d+[\.、\)）]\s*/, '').trim();
}
