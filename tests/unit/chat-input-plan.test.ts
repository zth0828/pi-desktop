import { describe, expect, it } from 'vitest';
import { computeModePrefix, hasPlanCommandPrefix } from '../../src/pages/Chat/chat-input/mode-prefix';

describe('chat-input-plan (Plan 模式前缀与命令判定)', () => {
  it('正确识别 /plan 与 /plan-mode（含全角／与参数）', () => {
    expect(hasPlanCommandPrefix('/plan')).toBe(true);
    expect(hasPlanCommandPrefix('/plan 做个规划')).toBe(true);
    expect(hasPlanCommandPrefix('／plan 需求分析')).toBe(true);
    expect(hasPlanCommandPrefix('/plan-mode')).toBe(true);
    expect(hasPlanCommandPrefix('/plan-mode 启动')).toBe(true);
    expect(hasPlanCommandPrefix('／plan-mode 启动')).toBe(true);
    expect(hasPlanCommandPrefix('  /plan 缩进测试  ')).toBe(true);

    expect(hasPlanCommandPrefix('/planner')).toBe(false);
    expect(hasPlanCommandPrefix('普通消息')).toBe(false);
    expect(hasPlanCommandPrefix('/tree')).toBe(false);
  });

  it('处于 planMode 且文本不带 /plan 时，自动补充 /plan 前缀', () => {
    const prefix = computeModePrefix('帮我增加登录功能', true, null);
    expect(prefix).toBe('/plan ');
  });

  it('处于 planMode 但文本已显式带 /plan 时，严禁重复拼接 /plan', () => {
    expect(computeModePrefix('/plan 帮我增加登录功能', true, null)).toBe('');
    expect(computeModePrefix('/plan-mode 帮我增加登录功能', true, null)).toBe('');
    expect(computeModePrefix('／plan 帮我增加登录功能', true, null)).toBe('');
    expect(computeModePrefix('/plan exit', true, null)).toBe('');
    expect(computeModePrefix('/plan-mode quit', true, null)).toBe('');
  });

  it('未开启 planMode 时，不添加 /plan 前缀', () => {
    expect(computeModePrefix('普通提问', false, null)).toBe('');
    expect(computeModePrefix('/plan 自带前缀提问', false, null)).toBe('');
  });

  it('selectedSkill 存在且非 planMode 时，添加 /skill 前缀', () => {
    expect(computeModePrefix('提交代码', false, 'git')).toBe('/skill:git ');
  });
});
