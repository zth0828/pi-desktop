import { useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { isProbablyBinary, MAX_FILE_TEXT_BYTES } from '@shared/file-references';
import { fileToStagedImage, type StagedAttachment } from './types';

export interface UseComposerAttachmentsOptions {
  attachments: StagedAttachment[];
  setAttachments: (next: StagedAttachment[] | ((current: StagedAttachment[]) => StagedAttachment[])) => void;
  cwd?: string;
  value?: string;
  setValue?: (next: string | ((current: string) => string)) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onInsertMention?: (relPath: string) => void;
}

export function useComposerAttachments({
  attachments,
  setAttachments,
  cwd,
  setValue,
  textareaRef,
  onInsertMention,
}: UseComposerAttachmentsOptions) {
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

  const stageFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const staged = await fileToStagedImage(file);
          setAttachments((prev) => {
            if (prev.some((a) => a.kind === 'image' && a.name === staged.name)) {
              return prev;
            }
            return [...prev, staged];
          });
        } catch {
          // ignore unreadable image
        }
      } else {
        try {
          const text = await file.text();
          if (!isProbablyBinary(text) && file.size <= MAX_FILE_TEXT_BYTES) {
            setAttachments((prev) => {
              if (prev.some((a) => a.kind === 'file' && a.name === file.name)) {
                return prev;
              }
              return [...prev, { kind: 'file', name: file.name, text }];
            });
          }
        } catch {
          // ignore unreadable file
        }
      }
    }
  };

  const insertTextAtCursor = (textToInsert: string) => {
    const textarea = textareaRef?.current;
    if (!textarea || !setValue) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const currentVal = textarea.value;
    const nextVal = currentVal.slice(0, start) + textToInsert + currentVal.slice(end);
    setValue(nextVal);
    const nextCursor = start + textToInsert.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const insertMentionAtCursor = (relPath: string) => {
    const formatted = relPath.includes(' ') ? `@"${relPath}" ` : `@${relPath} `;
    insertTextAtCursor(formatted);
  };

  const handleComposerDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // 1. 检查是否来自内部文件树拖拽 (application/x-pi-file-mention / text/x-pi-file-mention)
    const mentionData =
      e.dataTransfer.getData('application/x-pi-file-mention') ||
      e.dataTransfer.getData('text/x-pi-file-mention');
    if (mentionData) {
      if (onInsertMention) {
        onInsertMention(mentionData);
      } else {
        insertMentionAtCursor(mentionData);
      }
      return;
    }

    // 检查 plain text 是否含 mention 前缀 (如直接拖拽了 text/plain)
    const plain = e.dataTransfer.getData('text/plain');
    if (plain && (plain.startsWith('@"') || plain.startsWith('@'))) {
      const cleanMention = plain.replace(/^@"?|"?\s*$/g, '');
      if (onInsertMention && cleanMention) {
        onInsertMention(cleanMention);
      } else {
        insertTextAtCursor(plain.endsWith(' ') ? plain : `${plain} `);
      }
      return;
    }

    // 2. 检查拖入的文件列表
    const transferFiles = Array.from(e.dataTransfer.files);
    if (transferFiles.length === 0) {
      return;
    }

    const externalFiles: File[] = [];

    for (const file of transferFiles) {
      const rawPath = (file as File & { path?: string }).path;
      if (rawPath && cwd) {
        const normalizedFile = rawPath.replace(/\\/g, '/');
        const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
        if (normalizedFile === normalizedCwd || normalizedFile.startsWith(normalizedCwd + '/')) {
          const relPath = normalizedFile.slice(normalizedCwd.length + 1);
          if (relPath) {
            if (onInsertMention) {
              onInsertMention(relPath);
            } else {
              insertMentionAtCursor(relPath);
            }
            continue;
          }
        }
      }
      externalFiles.push(file);
    }

    if (externalFiles.length > 0) {
      await stageFiles(externalFiles);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void stageFiles(files);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return {
    attachments,
    previewImage,
    setPreviewImage,
    stageFiles,
    onPaste,
    onDrop: handleComposerDrop,
    handleComposerDrop,
    removeAttachment,
  };
}
