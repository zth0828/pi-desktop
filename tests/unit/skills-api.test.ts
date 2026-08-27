import { describe, expect, it } from 'vitest';
import { updateDisableModelInvocation } from '../../electron/services/skills-api';

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
