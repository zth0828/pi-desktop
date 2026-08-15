import { formatFileBlock } from './file-references';

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

export type ParsedUserMessage = {
  text: string;
  attachments: MessageAttachmentDescriptor[];
  files: ParsedMessageFile[];
};

const MANIFEST_RE = /^<attachments>\n([\s\S]*?)<\/attachments>\n?/;
const ATTACHMENT_RE = /<attachment\s+([^>]+)><\/attachment>/g;
const ATTRIBUTE_RE = /([\w-]+)="([^"]*)"/g;
const FILE_RE = /<file name="([^"]*)">\n?([\s\S]*?)\n?<\/file>\n?/g;

// 标题等纯文本场景用：位置不限、可多处出现（MANIFEST_RE 锚定开头，只服务解析）。
const ENVELOPE_RE = /<attachments>[\s\S]*?<\/attachments>/g;
const FILE_BLOCK_RE = /<file name="[^"]*">[\s\S]*?<\/file>/g;

/** 去掉附件信封与文件块后剩余的纯文字（会话标题等展示场景用）。 */
export function stripAttachmentEnvelope(text: string): string {
  return text.replace(ENVELOPE_RE, '').replace(FILE_BLOCK_RE, '').trim();
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

/** Extract shell metadata and Pi-compatible file blocks for user presentation. */
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

  const withoutManifest = manifest ? text.slice(manifest[0].length) : text;
  const files: ParsedMessageFile[] = [];
  const visibleText = withoutManifest.replace(FILE_RE, (_block, name: string, fileText: string) => {
    files.push({ name, text: fileText });
    return '';
  });

  return {
    text: visibleText.trim(),
    attachments: attachments.sort((a, b) => a.index - b.index),
    files,
  };
}
