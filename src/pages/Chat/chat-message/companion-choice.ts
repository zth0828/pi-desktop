/**
 * 检测 assistant 消息是否正在以带数字序号的选项向用户提问。
 * 排除代码块后，文本包含至少 2 个序号项（如 1. / 1) / 1、 / (1)），且包含提问/选择关键词或问号。
 */
export function isPromptingForChoices(text: string): boolean {
  if (!text || text.length < 10) return false;
  const stripped = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .trim();

  const optionMatches = stripped.match(/^\s*(?:[1-9][0-9]*[\.、\)]|\([1-9][0-9]*\)|[①-⑩])\s+\S+/gm);
  if (!optionMatches || optionMatches.length < 2) return false;

  const choiceCueRegex = /(?:回复.*[1-9]|选哪个|哪一种|哪一个|哪个|哪项|怎么处理|希望采用|输入.*[1-9]|序号|请选择|您的选择|您的意见|哪个方案|choose|reply\s+with|which\s+(?:option|approach)|select\s+[1-9]|option\s+[1-9]|your\s+choice)/i;
  return choiceCueRegex.test(stripped) || /[?？]\s*$/m.test(stripped);
}
