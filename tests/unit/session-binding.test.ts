// 渲染层按窗口绑定会话过滤事件/状态推送的判定逻辑（stores/chat 使用）。
import { describe, expect, it } from 'vitest';
import {
  matchesBoundSession,
  nextReplacementActionId,
  shouldApplySessionReplaced,
} from '@/lib/session-binding';

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
    // 无相关性上下文（旧事件/switch 兜底等待）保持原放行行为
    expect(shouldApplySessionReplaced('s1', 's2', true)).toBe(true);
  });

  it('删除驱动的替换凭 replacesSessionId 认领（仅被删会话的面板）', () => {
    expect(shouldApplySessionReplaced('s1', 's2', false, { replacesSessionId: 's1' })).toBe(true);
    expect(shouldApplySessionReplaced('s3', 's2', false, { replacesSessionId: 's1' })).toBe(false);
  });
});

describe('shouldApplySessionReplaced 相关性匹配（面板劫持竞态）', () => {
  it('事件动作 id 与本地记录一致才放行（并发替换各认领各的）', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', true, { eventActionId: 'a1', expectedActionId: 'a1' }),
    ).toBe(true);
  });

  it('事件动作 id 与本地记录不一致不应用（他人面板发起的替换不劫持本面板）', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', true, { eventActionId: 'a2', expectedActionId: 'a1' }),
    ).toBe(false);
  });

  it('带动作 id 的事件不劫持未记录动作 id 的等待（switch 兜底中的面板）', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', true, { eventActionId: 'a1', expectedActionId: null }),
    ).toBe(false);
  });

  it('记录了动作 id 的等待只认领带同 id 的事件：无动作 id 的广播不放行', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', true, { expectedActionId: 'a1' }),
    ).toBe(false);
  });

  it('无动作 id 的等待放行无动作 id 的事件（switch 兜底路径保持原行为）', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', true, { expectedActionId: null }),
    ).toBe(true);
  });

  it('相关性不匹配但 replacesSessionId 命中的仍认领（删除驱动的替换优先）', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', false, { replacesSessionId: 's1', eventActionId: 'a1', expectedActionId: null }),
    ).toBe(true);
  });

  it('未处于 expecting 时不因相关性放行', () => {
    expect(
      shouldApplySessionReplaced('s1', 's-new', false, { eventActionId: 'a1', expectedActionId: 'a1' }),
    ).toBe(false);
  });

  it('bound 为 null 的等待面板同样只认领自己发起的事件（attach 劫持防护）', () => {
    expect(
      shouldApplySessionReplaced(null, 's-new', true, { eventActionId: 'a1', expectedActionId: 'a1' }),
    ).toBe(true);
    expect(
      shouldApplySessionReplaced(null, 's-new', true, { eventActionId: 'a2', expectedActionId: 'a1' }),
    ).toBe(false);
    expect(
      shouldApplySessionReplaced(null, 's-new', true, { eventActionId: 'a2', expectedActionId: null }),
    ).toBe(false);
    // 无等待 / 无动作 id 事件保持单窗口初始态全放行
    expect(shouldApplySessionReplaced(null, 's-new', false, { eventActionId: 'a1' })).toBe(true);
    expect(shouldApplySessionReplaced(null, 's-new', true)).toBe(true);
  });
});

describe('nextReplacementActionId（动作 id 生成）', () => {
  it('同进程内严格递增，不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextReplacementActionId()));
    expect(ids.size).toBe(50);
  });
});
