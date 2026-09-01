/**
 * 解析 SKILL.md 文档：分离 YAML Frontmatter 与纯正文 Markdown。
 */
export interface ParsedSkillDoc {
  name?: string;
  version?: string;
  description?: string;
  disableModelInvocation: boolean;
  rawFrontmatter?: string;
  body: string;
}

export function parseSkillDocument(content: string): ParsedSkillDoc {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    return {
      disableModelInvocation: false,
      body: content.trim(),
    };
  }

  const rawFrontmatter = match[1];
  const body = (match[2] ?? '').trim();

  let name: string | undefined;
  let version: string | undefined;
  let disableModelInvocation = false;
  let description: string | undefined;

  const lines = rawFrontmatter.split(/\r?\n/);
  let currentKey = '';
  let multilineDesc: string[] = [];

  for (const line of lines) {
    const topKeyMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (topKeyMatch) {
      if (currentKey === 'description' && multilineDesc.length > 0 && !description) {
        description = multilineDesc.join(' ').trim();
        multilineDesc = [];
      }
      const key = topKeyMatch[1];
      const val = topKeyMatch[2].trim();
      currentKey = key;

      if (key === 'name') {
        name = val.replace(/^["']|["']$/g, '');
      } else if (key === 'version') {
        version = val.replace(/^["']|["']$/g, '');
      } else if (key === 'disable-model-invocation') {
        disableModelInvocation = val.toLowerCase() === 'true';
      } else if (key === 'description') {
        if (val === '>' || val === '|') {
          multilineDesc = [];
        } else if (val) {
          description = val.replace(/^["']|["']$/g, '');
        }
      }
    } else if (currentKey === 'description') {
      const trimmed = line.trim();
      if (trimmed) {
        multilineDesc.push(trimmed);
      }
    }
  }

  if (currentKey === 'description' && multilineDesc.length > 0 && !description) {
    description = multilineDesc.join(' ').trim();
  }

  return {
    name,
    version,
    description,
    disableModelInvocation,
    rawFrontmatter,
    body,
  };
}
