import { describe, expect, it } from 'vitest';
import { isValidSkillName, updateDisableModelInvocation } from '../../electron/services/skills-api';

describe('updateDisableModelInvocation frontmatter updater', () => {
  it('adds disable-model-invocation: true when frontmatter exists without it', () => {
    const original = `---
name: my-skill
description: A helpful skill
---

# Instructions
Run this command.`;

    const updated = updateDisableModelInvocation(original, true);
    expect(updated).toContain('disable-model-invocation: true');
    expect(updated).toContain('name: my-skill');
    expect(updated).toContain('description: A helpful skill');
    expect(updated).toContain('# Instructions\nRun this command.');
  });

  it('updates disable-model-invocation from false to true', () => {
    const original = `---
name: my-skill
description: A helpful skill
disable-model-invocation: false
---

# Instructions`;

    const updated = updateDisableModelInvocation(original, true);
    expect(updated).toContain('disable-model-invocation: true');
    expect(updated).not.toContain('disable-model-invocation: false');
  });

  it('removes disable-model-invocation line when disabling flag (setting to false)', () => {
    const original = `---
name: my-skill
description: A helpful skill
disable-model-invocation: true
---

# Instructions`;

    const updated = updateDisableModelInvocation(original, false);
    expect(updated).not.toContain('disable-model-invocation');
    expect(updated).toContain('name: my-skill');
    expect(updated).toContain('description: A helpful skill');
    expect(updated).toContain('# Instructions');
  });

  it('handles content without frontmatter by wrapping with frontmatter when enabling', () => {
    const original = `# Plain Instructions`;
    const updated = updateDisableModelInvocation(original, true);
    expect(updated).toBe(`---\ndisable-model-invocation: true\n---\n\n# Plain Instructions`);
  });

  it('leaves content without frontmatter untouched when setting to false', () => {
    const original = `# Plain Instructions`;
    const updated = updateDisableModelInvocation(original, false);
    expect(updated).toBe(original);
  });
});

describe('isValidSkillName', () => {
  it('放行正常合法的技能名称', () => {
    expect(isValidSkillName('my-skill')).toBe(true);
    expect(isValidSkillName('code-review_v2')).toBe(true);
    expect(isValidSkillName('Skill123')).toBe(true);
  });

  it('拦截 Windows 保留设备名称与非法字符', () => {
    expect(isValidSkillName('CON')).toBe(false);
    expect(isValidSkillName('prn')).toBe(false);
    expect(isValidSkillName('AUX')).toBe(false);
    expect(isValidSkillName('NUL')).toBe(false);
    expect(isValidSkillName('com1')).toBe(false);
    expect(isValidSkillName('lpt2')).toBe(false);
    expect(isValidSkillName('con.txt')).toBe(false);
    expect(isValidSkillName('skill:test')).toBe(false);
    expect(isValidSkillName('skill*name')).toBe(false);
    expect(isValidSkillName('skill?')).toBe(false);
    expect(isValidSkillName('skill<1>')).toBe(false);
    expect(isValidSkillName('skill|pipe')).toBe(false);
    expect(isValidSkillName('skill/slash')).toBe(false);
    expect(isValidSkillName('skill\\backslash')).toBe(false);
    expect(isValidSkillName('..')).toBe(false);
    expect(isValidSkillName('.')).toBe(false);
    expect(isValidSkillName('skill.')).toBe(false);
    expect(isValidSkillName('skill ')).toBe(false);
    expect(isValidSkillName('')).toBe(false);
  });
});
