/**
 * 判断输入文本是否已显式以 /plan 或 /plan-mode 命令（含全角／）开头
 */
export function hasPlanCommandPrefix(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed === '/plan' ||
    trimmed.startsWith('/plan ') ||
    trimmed === '／plan' ||
    trimmed.startsWith('／plan ') ||
    trimmed === '/plan-mode' ||
    trimmed.startsWith('/plan-mode ') ||
    trimmed === '／plan-mode' ||
    trimmed.startsWith('／plan-mode ')
  );
}

/**
 * 计算发送提示词时的模式前缀。
 * 若用户文本已包含 /plan 命令前缀，即使处于 planMode 下也严禁重复拼接 /plan。
 */
export function computeModePrefix(
  text: string,
  planMode: boolean,
  selectedSkill: string | null,
): string {
  if (planMode && !hasPlanCommandPrefix(text)) {
    return '/plan ';
  }
  if (selectedSkill) {
    return `/skill:${selectedSkill} `;
  }
  return '';
}
