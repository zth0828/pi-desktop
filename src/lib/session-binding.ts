// 渲染层按窗口绑定会话过滤事件/状态推送的纯判定逻辑。
// 独立成无依赖模块：node 侧单测直接引用（不把 stores/chat → host-api 链的 window 拖进程序）。

/**
 * 流式事件 envelope / uiRequest 是否属于本窗口绑定的会话。
 * boundSessionId 为 null = 尚未绑定（主窗口初始态），保持单窗口行为全放行。
 */
export function matchesBoundSession(boundSessionId: string | null, sessionId: string): boolean {
  return !boundSessionId || boundSessionId === sessionId;
}

/** sessionReplaced 的相关性上下文 */
export type ReplacementCorrelation = {
  /** 删除驱动的替换：被删会话的原 sessionId。 */
  replacesSessionId?: string;
  /** 事件回显的发起动作 id（newSession/fork 请求携带）；undefined = 事件不带发起上下文。 */
  eventActionId?: string;
  /** 本面板发起替换时记录的动作 id；null = 等待无发起上下文的事件（switch 兜底）。 */
  expectedActionId?: string | null;
};

/** expectingReplacement 超时兜底写入 runtimeError 的哨兵值；展示层翻译为 i18n 文案。 */
export const SESSION_REPLACEMENT_TIMEOUT = 'session-replacement-timeout';

/**
 * sessionReplaced 是否应用：匹配当前绑定会话，或本面板刚发起会话替换
 * （newSession/fork 后 sessionId 会变，由 expectingReplacement 放行一次）。
 * replacesSessionId：删除会话驱动的替换（main 删文件前把 runtime 切到新会话），
 * 正在查看被删会话的面板凭它认领到新会话。
 *
 * expectingReplacement 的放行必须过相关性匹配：同窗口多面板并发发起替换时，
 * 先到达的事件若不带匹配的发起动作 id，属于其他面板的替换，放行会把本面板
 * 劫持到别人的会话。事件不带动作 id（switch 广播等 main 内部发起的替换）时，
 * 只放行同样未记录动作 id 的等待。
 */
export function shouldApplySessionReplaced(
  boundSessionId: string | null,
  stateSessionId: string,
  expectingReplacement: boolean,
  correlation?: ReplacementCorrelation,
): boolean {
  const { replacesSessionId, eventActionId, expectedActionId = null } = correlation ?? {};
  // 未绑定（单窗口初始态）保持全放行，但等待替换中的面板只认领自己发起的
  // 事件：attach 面板（bound 尚为 null）不能被其他面板的替换事件劫持
  if (!boundSessionId) {
    return !expectingReplacement
      || eventActionId === undefined
      || eventActionId === expectedActionId;
  }
  if (stateSessionId === boundSessionId) return true;
  if (replacesSessionId !== undefined && replacesSessionId === boundSessionId) return true;
  if (!expectingReplacement) return false;
  if (eventActionId !== undefined) return eventActionId === expectedActionId;
  return expectedActionId === null;
}

let replacementActionSequence = 0;

/**
 * 生成本渲染进程内唯一的替换动作 id。newSession/fork 发起时记录，
 * main 在 sessionReplaced 中回显，面板据此只认领自己发起的替换事件。
 * 不同窗口是独立进程；携带动作 id 的事件只定向发给发起窗口，跨窗口不会碰撞。
 */
export function nextReplacementActionId(): string {
  replacementActionSequence += 1;
  return `replacement-${replacementActionSequence}`;
}
