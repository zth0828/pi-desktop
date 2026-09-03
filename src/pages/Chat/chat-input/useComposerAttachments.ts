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
}

export function useComposerAttachments({
  attachments,
  setAttachments,
  cwd,
  setValue,
  textareaRef,
}: UseComposerAttachmentsOptions) {
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

  const stageFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const staged = await fileToStagedImage(file);
          setAttachments((prev) => [...prev, staged]);
        } catch {
          // 忽略读不了的文件
        }
        continue;
      }
      if (file.size > MAX_FILE_TEXT_BYTES) continue;
      try {
        const text = await file.text();
        if (isProbablyBinary(text)) continue;
        setAttachments((prev) => [...prev, { kind: 'file', name: file.name, text }]);
      } catch {
        // 忽略读不了的文件
      }
    }
  };

  const insertMentionAtCursor = (relPath: string) => {
    const formatted = relPath.includes(' ') ? `@"${relPath}" ` : `@${relPath} `;
    const textarea = textareaRef?.current;
    if (textarea && setValue) {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const curr = textarea.value;
      const next = curr.slice(0, start) + formatted + curr.slice(end);
      setValue(next);
      const nextPos = start + formatted.length;
      const schedule =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (cb: () => void) => setTimeout(cb, 0);
      schedule(() => {
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      });
    } else if (setValue) {
      setValue((curr) => `${curr}${curr.endsWith(' ') || curr === '' ? '' : ' '}${formatted}`);
    }
  };

  const handleComposerDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();

    // 1. 检查是否来自内部文件树拖拽 (application/x-pi-file-mention)
    const mentionData = e.dataTransfer.getData('application/x-pi-file-mention');
    if (mentionData) {
      insertMentionAtCursor(mentionData);
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
            insertMentionAtCursor(relPath);
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
