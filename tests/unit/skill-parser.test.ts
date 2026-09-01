import { describe, expect, it } from 'vitest';
import { parseSkillDocument } from '../../shared/skill-parser';

describe('parseSkillDocument', () => {
  it('parses frontmatter and separates clean markdown body', () => {
    const raw = `---
name: lark-approval
version: 1.2.0
description: "飞书审批：查询和处理审批待办"
disable-model-invocation: true
---

**CRITICAL**

## 路由优先级
审批相关优先走本技能。
`;

    const res = parseSkillDocument(raw);
    expect(res.name).toBe('lark-approval');
    expect(res.version).toBe('1.2.0');
    expect(res.description).toBe('飞书审批：查询和处理审批待办');
    expect(res.disableModelInvocation).toBe(true);
    expect(res.body).toBe('**CRITICAL**\n\n## 路由优先级\n审批相关优先走本技能。');
  });

  it('handles multi-line descriptions with > folded syntax', () => {
    const raw = `---
name: lark-whiteboard
version: 1.0.0
description: >
  飞书画板：查询和编辑飞书云文档中的画板。
  当用户需要查看画板内容时使用。
metadata:
  bins: ["lark-cli"]
---

## Commands
`;

    const res = parseSkillDocument(raw);
    expect(res.name).toBe('lark-whiteboard');
    expect(res.version).toBe('1.0.0');
    expect(res.description).toContain('飞书画板：查询和编辑飞书云文档中的画板。 当用户需要查看画板内容时使用。');
    expect(res.disableModelInvocation).toBe(false);
    expect(res.body).toBe('## Commands');
  });

  it('handles document without frontmatter', () => {
    const raw = '# Just markdown\n\nSome plain text.';
    const res = parseSkillDocument(raw);
    expect(res.name).toBeUndefined();
    expect(res.disableModelInvocation).toBe(false);
    expect(res.body).toBe(raw);
  });
});
