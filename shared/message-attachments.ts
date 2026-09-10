import { formatFileBlock, imageMediaTypeForPath } from './file-references';

export type OrderedPromptAttachment =
  | { kind: 'image'; name: string }
  | { kind: 'file'; name: string; text: string };

export type MessageAttachmentDescriptor = {
  index: number;
  kind: 'image' | 'file';
  name: string;
  imageIndex?: number;
};

export type ParsedMessageFile = {
  name: string;
  text: string;
};

export type ParsedSkillBlock = {
  name: string;
  location?: string;
  content: string;
};

export type ParsedUserMessage = {
  text: string;
  attachments: MessageAttachmentDescriptor[];
  files: ParsedMessageFile[];
  skills: ParsedSkillBlock[];
};

const MANIFEST_RE = /<attachments>\n?([\s\S]*?)<\/attachments>\n?/;
const ATTACHMENT_RE = /<attachment\s+([^>]+)><\/attachment>/g;
const ATTRIBUTE_RE = /([\w-]+)="([^"]*)"/g;
const FILE_RE = /<file name="([^"]*)">\n?([\s\S]*?)\n?<\/file>\n?/g;
const SKILL_RE = /<skill\s+name="([^"]+)"(?:\s+location="([^"]+)")?>\n?([\s\S]*?)\n?<\/skill>\n?/g;

// 标题等纯文本场景用：位置不限、可多处出现（MANIFEST_RE 锚定开头，只服务解析）。
const ENVELOPE_RE = /<attachments>[\s\S]*?<\/attachments>/g;
const FILE_BLOCK_RE = /<file name="[^"]*">[\s\S]*?<\/file>/g;
const SKILL_BLOCK_RE = /<skill\s+[^>]*>[\s\S]*?<\/skill>/g;

/** 去掉附件信封、文件块与技能块后剩余的纯文字（会话标题等展示场景用）。 */
export function stripAttachmentEnvelope(text: string): string {
  return text
    .replace(ENVELOPE_RE, '')
    .replace(FILE_BLOCK_RE, '')
    .replace(SKILL_BLOCK_RE, '')
    .trim();
}

function encodeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
function decodeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Pi receives one text part followed by an ordered image array. This manifest
 * makes the relationship explicit without replacing Pi's native prompt API.
 */
export function formatOrderedAttachmentPrompt(
  text: string,
  attachments: OrderedPromptAttachment[],
): string {
  if (attachments.length === 0) return text;
  let imageIndex = 0;
  const rows = attachments.map((attachment, offset) => {
    const index = offset + 1;
    const name = encodeAttribute(attachment.name);
    if (attachment.kind === 'image') {
      imageIndex += 1;
      return `<attachment index="${index}" kind="image" name="${name}" image-index="${imageIndex}"></attachment>`;
    }
    return `<attachment index="${index}" kind="file" name="${name}"></attachment>`;
  });
  const files = attachments
    .filter((attachment): attachment is Extract<OrderedPromptAttachment, { kind: 'file' }> => attachment.kind === 'file')
    .map((attachment) => formatFileBlock(attachment.name, attachment.text))
    .join('');
  return `<attachments>\n${rows.join('\n')}\n</attachments>\n${files}${text}`;
}

/** Extract shell metadata, Pi-compatible file blocks and skill invocation blocks for user presentation. */
export function parseUserMessage(text: string): ParsedUserMessage {
  const attachments: MessageAttachmentDescriptor[] = [];
  const manifest = text.match(MANIFEST_RE);
  if (manifest) {
    for (const row of manifest[1].matchAll(ATTACHMENT_RE)) {
      const attributes = new Map<string, string>();
      for (const attribute of row[1].matchAll(ATTRIBUTE_RE)) {
        attributes.set(attribute[1], decodeAttribute(attribute[2]));
      }
      const index = Number(attributes.get('index'));
      const kind = attributes.get('kind');
      const name = attributes.get('name');
      const imageIndex = Number(attributes.get('image-index'));
      if (!Number.isInteger(index) || index < 1 || !name || (kind !== 'image' && kind !== 'file')) continue;
      attachments.push({
        index,
        kind,
        name,
        ...(kind === 'image' && Number.isInteger(imageIndex) && imageIndex > 0 ? { imageIndex } : {}),
      });
    }
  }

  const withoutManifest = manifest ? text.replace(manifest[0], '') : text;
  const skills: ParsedSkillBlock[] = [];
  const textWithoutSkills = withoutManifest.replace(
    SKILL_RE,
    (_block, name: string, location: string | undefined, content: string) => {
      skills.push({ name, location: location || undefined, content: content.trim() });
      return '';
    },
  );
  const files: ParsedMessageFile[] = [];
  const visibleText = textWithoutSkills.replace(FILE_RE, (_block, name: string, fileText: string) => {
    files.push({ name, text: fileText });
    return '';
  });

  return {
    text: visibleText.trim(),
    attachments: attachments.sort((a, b) => a.index - b.index),
    files,
    skills,
  };
}

export type QueueDisplayAttachment = {
  key: string;
  index: number;
  kind: 'image' | 'file';
  name: string;
  fullName: string;
  imageIndex?: number;
};

export type QueueDisplayInfo = {
  attachments: QueueDisplayAttachment[];
  displayText: string;
};

/** 规范化文件展示路径：相对 cwd 的文件去除前缀，外部绝对路径保持原样。 */
export function normalizeDisplayPath(filePath: string, cwd?: string): string {
  let normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  if (!cwd) return normalized;
  const root = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized === root) return '.';
  if (normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  const privateRoot = root.startsWith('/private/')
    ? root.slice('/private'.length)
    : `/private${root}`;
  if (normalized.startsWith(`${privateRoot}/`)) {
    return normalized.slice(privateRoot.length + 1);
  }
  return normalized;
}

/** 规范化附件卡片展示文案：优先展示简洁文件名（外部绝对路径展示文件名，避免 /Users/... 长路径挤占换行）。 */
export function formatAttachmentDisplayName(filePath: string, cwd?: string): string {
  const normalized = normalizeDisplayPath(filePath, cwd);
  if (normalized.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(normalized)) {
    const parts = normalized.split(/[/\\]/);
    return parts[parts.length - 1] || normalized;
  }
  return normalized;
}

/**
 * 提取排队消息的完整附件列表（支持外部文件/图片信封 + 侧边栏/项目 @path 展开的文件块）
 * 以及适合展示的干净纯文本。
 */
export function extractQueueAttachments(text: string, cwd?: string): QueueDisplayInfo {
  const parsed = parseUserMessage(text);
  const attachments: QueueDisplayAttachment[] = [];
  const usedFileNames = new Set<string>();

  // 1. 信封清单里的附件（外部上传的文件与暂存图片）
  for (const att of parsed.attachments) {
    usedFileNames.add(att.name);
    const basename = att.name.split(/[/\\]/).pop() || att.name;
    usedFileNames.add(basename);
    attachments.push({
      key: `att-${att.index}-${att.name}`,
      index: att.index,
      kind: att.kind,
      name: formatAttachmentDisplayName(att.name, cwd),
      fullName: att.name,
      imageIndex: att.imageIndex,
    });
  }

  // 2. 独立 <file> 块（侧边栏文件、项目文件、或 @path 就地展开生成的内容）
  for (const file of parsed.files) {
    const basename = file.name.split(/[/\\]/).pop() || file.name;
    if (usedFileNames.has(file.name) || usedFileNames.has(basename)) {
      continue;
    }
    usedFileNames.add(file.name);
    usedFileNames.add(basename);

    const isImage = imageMediaTypeForPath(file.name) !== undefined;
    const nextIndex = attachments.length + 1;
    attachments.push({
      key: `file-${nextIndex}-${file.name}`,
      index: nextIndex,
      kind: isImage ? 'image' : 'file',
      name: formatAttachmentDisplayName(file.name, cwd),
      fullName: file.name,
    });
  }

  const hasAttachments = attachments.length > 0;
  const displayText = parsed.text || (hasAttachments ? '' : stripAttachmentEnvelope(text).replace(/\s+/g, ' ').trim());

  return {
    attachments,
    displayText,
  };
}

