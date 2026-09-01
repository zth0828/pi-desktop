import type { ChatMessage, ComposerAttachment } from './chat-types';
import { parseUserMessage } from '@shared/message-attachments';

/**
 * 还原单段文本到输入框（剥离信封与文件块，还原文件附件）。
 * 用于 abort 排队恢复、/tree 导航与 queueRemove 文本回填。
 */
export function restoreFromText(text: string): { text: string; attachments: ComposerAttachment[] } {
  const parsed = parseUserMessage(text);
  const attachments: ComposerAttachment[] = parsed.files.map((file) => ({
    kind: 'file',
    name: file.name,
    text: file.text,
  }));
  return {
    text: parsed.text,
    attachments,
  };
}

/**
 * 将一条完整 user 消息还原为输入框可编辑的文本与附件列表（图片 + 文件）。
 * 结合信封 manifest 与消息原生 content blocks 对齐图片/文件顺序。
 */
export function restoreToComposer(message: ChatMessage): {
  text: string;
  attachments: ComposerAttachment[];
} {
  const rawText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
  const parsed = parseUserMessage(rawText);

  const images: Array<{ data: string; mimeType: string; previewUrl: string }> = [];
  for (const b of message.content) {
    if (b.type === 'image') {
      const block = b as {
        data?: string;
        mimeType?: string;
        source?: { mediaType?: string; data?: string };
      };
      const data = block.data ?? block.source?.data ?? '';
      const mimeType = block.mimeType ?? block.source?.mediaType ?? 'image/png';
      const previewUrl = data ? `data:${mimeType};base64,${data}` : '';
      images.push({ data, mimeType, previewUrl });
    }
  }

  const usedImages = new Set<number>();
  const usedFiles = new Set<number>();
  const attachments: ComposerAttachment[] = [];

  for (const att of parsed.attachments) {
    if (att.kind === 'image') {
      const imageOffset = (att.imageIndex ?? 0) - 1;
      const img = images[imageOffset];
      if (img) {
        usedImages.add(imageOffset);
        attachments.push({
          kind: 'image',
          name: att.name,
          data: img.data,
          mediaType: img.mimeType,
          previewUrl: img.previewUrl,
        });
      }
    } else if (att.kind === 'file') {
      const fileOffset = parsed.files.findIndex(
        (f, idx) => f.name === att.name && !usedFiles.has(idx),
      );
      if (fileOffset >= 0) {
        usedFiles.add(fileOffset);
        const f = parsed.files[fileOffset];
        attachments.push({
          kind: 'file',
          name: f.name,
          text: f.text,
        });
      }
    }
  }

  // 兜底：未包含在 manifest 中的遗留图片或文件
  images.forEach((img, idx) => {
    if (!usedImages.has(idx)) {
      attachments.push({
        kind: 'image',
        name: `image-${idx + 1}.png`,
        data: img.data,
        mediaType: img.mimeType,
        previewUrl: img.previewUrl,
      });
    }
  });

  parsed.files.forEach((file, idx) => {
    if (!usedFiles.has(idx)) {
      attachments.push({
        kind: 'file',
        name: file.name,
        text: file.text,
      });
    }
  });

  return {
    text: parsed.text,
    attachments,
  };
}
