/**
 * 检测 assistant 消息是否正在建议或提及使用子智能体 / subagent 进行任务委派。
 * 排除代码块与行内代码后，同时匹配 subagent/角色关键词与动作建议动词。
 */
export function isSuggestingSubagent(text: string): boolean {
  if (!text || text.length < 10) return false;

  const stripped = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .trim();

  // 1. 角色特征词：subagent, 子 agent, 子智能体, scout, reviewer, researcher 等
  const agentRoleRegex = /(?:subagent[s]?|子\s*agent|子智能体|scout|reviewer|researcher)/i;
  if (!agentRoleRegex.test(stripped)) return false;

  // 2. 委派与建议动作词：建议、调用、使用、通过、派发、启动、借助、delegate、run、call 等
  const actionCueRegex = /(?:建议|需要|可以|通过|调用|使用|派发|启动|借助|委派|分派|delegate|recommend|suggest|use|call|run|invoke)/i;
  return actionCueRegex.test(stripped);
}
