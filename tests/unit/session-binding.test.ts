// 渲染层按窗口绑定会话过滤事件/状态推送的判定逻辑（stores/chat 使用）。
import { describe, expect, it } from 'vitest';
import { matchesBoundSession, shouldApplySessionReplaced } from '@/lib/session-binding';

describe('matchesBoundSession（envelope / uiRequest 过滤）', () => {
  it('bound 为 null（主窗口初始态）全放行，保持单窗口行为', () => {
    expect(matchesBoundSession(null, 's1')).toBe(true);
  });

  it('匹配绑定会话放行，异会话丢弃', () => {
    expect(matchesBoundSession('s1', 's1')).toBe(true);
    expect(matchesBoundSession('s1', 's2')).toBe(false);
  });
});

describe('shouldApplySessionReplaced（sessionReplaced 过滤）', () => {
  it('bound 为 null 时应用并建立绑定', () => {
    expect(shouldApplySessionReplaced(null, 's1', false)).toBe(true);
  });

  it('异会话推送在绑定后丢弃（其他窗口的切换不串台）', () => {
    expect(shouldApplySessionReplaced('s1', 's2', false)).toBe(false);
  });

  it('同会话推送（navigateTree/reload 等）始终应用', () => {
    expect(shouldApplySessionReplaced('s1', 's1', false)).toBe(true);
  });

  it('本窗口发起的会话替换（newSession/fork 后 sessionId 变）放行一次', () => {
    expect(shouldApplySessionReplaced('s1', 's2', true)).toBe(true);
  });

  it('删除驱动的替换凭 replacesSessionId 认领（仅被删会话的面板）', () => {
    expect(shouldApplySessionReplaced('s1', 's2', false, 's1')).toBe(true);
    expect(shouldApplySessionReplaced('s3', 's2', false, 's1')).toBe(false);
  });
});
