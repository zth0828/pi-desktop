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

  it('safely handles non-string content', () => {
    expect(updateDisableModelInvocation(undefined as unknown as string, true)).toBe('');
    expect(updateDisableModelInvocation(null as unknown as string, false)).toBe('');
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
    expect(isValidSkillName('CONIN$')).toBe(false);
    expect(isValidSkillName('conout$')).toBe(false);
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
    expect(isValidSkillName(undefined as unknown as string)).toBe(false);
    expect(isValidSkillName(null as unknown as string)).toBe(false);
    expect(isValidSkillName(123 as unknown as string)).toBe(false);
  });

  it('skillsApi.read 与 setInvocationMode 拦截 Windows 设备路径', async () => {
    const { skillsApi } = await import('../../electron/services/skills-api');
    const readRes = await skillsApi.read({ filePath: 'CON' });
    expect(readRes.content).toBe('');

    const missingRes = await skillsApi.read({ filePath: '/nonexistent/SKILL.md' });
    expect(missingRes.content).toBe('');

    const emptyRead = await skillsApi.read({ filePath: '' });
    expect(emptyRead.content).toBe('');

    const undefRead = await skillsApi.read({ filePath: undefined as unknown as string });
    expect(undefRead.content).toBe('');

    const modeRes = await skillsApi.setInvocationMode({ filePath: 'AUX', disableModelInvocation: true });
    expect(modeRes.ok).toBe(false);
    expect(modeRes.error).toBe('Skill file does not exist');

    const emptyMode = await skillsApi.setInvocationMode({ filePath: '', disableModelInvocation: true });
    expect(emptyMode.ok).toBe(false);
    expect(emptyMode.error).toBe('Skill file does not exist');

    const undefMode = await skillsApi.setInvocationMode({ filePath: undefined as unknown as string, disableModelInvocation: true });
    expect(undefMode.ok).toBe(false);
    expect(undefMode.error).toBe('Skill file does not exist');
  });
});

