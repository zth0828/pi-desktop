/**
 * pi SDK 提供会话名存储，但没有单独的 AI 标题生成 API。
 * 壳仅用首问生成稳定短标题，再通过 setSessionName 写回 pi。
 */
export function sessionTitleFromQuestion(question: string, fallback: string): string {
  const normalized = question.replace(/\s+/g, ' ').trim() || fallback;
  const chars = Array.from(normalized);
  return chars.length > 120 ? `${chars.slice(0, 120).join('')}…` : normalized;
}
