import { useState, type ClipboardEvent, type DragEvent } from 'react';
import { isProbablyBinary, MAX_FILE_TEXT_BYTES } from '@shared/file-references';
import { fileToStagedImage, type StagedAttachment, type StagedImage } from './types';

export interface UseComposerAttachmentsOptions {
  attachments: StagedAttachment[];
  setAttachments: (next: StagedAttachment[] | ((current: StagedAttachment[]) => StagedAttachment[])) => void;
}

export function useComposerAttachments({
  attachments,
  setAttachments,
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

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void stageFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      void stageFiles(Array.from(e.dataTransfer.files));
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
    onDrop,
    removeAttachment,
  };
}
