// 渲染层按窗口绑定会话过滤事件/状态推送的纯判定逻辑。
// 独立成无依赖模块：node 侧单测直接引用（不把 stores/chat → host-api 链的 window 拖进程序）。

/**
 * 流式事件 envelope / uiRequest 是否属于本窗口绑定的会话。
 * boundSessionId 为 null = 尚未绑定（主窗口初始态），保持单窗口行为全放行。
 */
export function matchesBoundSession(boundSessionId: string | null, sessionId: string): boolean {
  return !boundSessionId || boundSessionId === sessionId;
}

/**
 * sessionReplaced 是否应用：匹配当前绑定会话，或本窗口刚发起会话替换
 * （newSession/fork 后 sessionId 会变，由 expectingReplacement 放行一次）。
 */
export function shouldApplySessionReplaced(
  boundSessionId: string | null,
  stateSessionId: string,
  expectingReplacement: boolean,
): boolean {
  if (!boundSessionId) return true;
  return stateSessionId === boundSessionId || expectingReplacement;
}
