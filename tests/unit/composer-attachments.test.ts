import { describe, expect, it } from 'vitest';
import {
  disambiguateAttachmentName,
  extractFilesFromClipboard,
} from '../../src/pages/Chat/chat-input/useComposerAttachments';
import { composerAttachmentsCache } from '../../src/pages/Chat/chat-input/composer-attachments-cache';

describe('disambiguateAttachmentName', () => {
  it('保持不重名附件名不变', () => {
    const existing = new Set(['foo.png', 'bar.txt']);
    expect(disambiguateAttachmentName('baz.jpg', existing)).toBe('baz.jpg');
    expect(disambiguateAttachmentName('image.png', new Set())).toBe('image.png');
  });

  it('连续重名自动生成编号后缀', () => {
    const existing = new Set<string>();
    const first = disambiguateAttachmentName('image.png', existing);
    expect(first).toBe('image.png');
    existing.add(first);

    const second = disambiguateAttachmentName('image.png', existing);
    expect(second).toBe('image-2.png');
    existing.add(second);

    const third = disambiguateAttachmentName('image.png', existing);
    expect(third).toBe('image-3.png');
  });

  it('处理无扩展名或多点扩展名的文件名', () => {
    const existing = new Set(['screenshot', 'archive.tar.gz']);
    expect(disambiguateAttachmentName('screenshot', existing)).toBe('screenshot-2');
    expect(disambiguateAttachmentName('archive.tar.gz', existing)).toBe('archive.tar-2.gz');
  });
});

describe('extractFilesFromClipboard', () => {
  it('处理 null 或空剪贴板', () => {
    expect(extractFilesFromClipboard(null)).toEqual([]);
    expect(extractFilesFromClipboard({ files: [] } as unknown as DataTransfer)).toEqual([]);
  });

  it('优先从 files 提取', () => {
    const fakeFile1 = new File(['1'], 'img1.png', { type: 'image/png' });
    const fakeFile2 = new File(['2'], 'img2.png', { type: 'image/png' });
    const dataTransfer = {
      files: [fakeFile1, fakeFile2],
      items: [],
    } as unknown as DataTransfer;

    const extracted = extractFilesFromClipboard(dataTransfer);
    expect(extracted).toEqual([fakeFile1, fakeFile2]);
  });

  it('files 为空时从 items.getAsFile 提取', () => {
    const fakeFile = new File(['item'], 'pasted.png', { type: 'image/png' });
    const dataTransfer = {
      files: [],
      items: [
        { kind: 'file', getAsFile: () => fakeFile },
        { kind: 'string', getAsFile: () => null },
      ],
    } as unknown as DataTransfer;

    const extracted = extractFilesFromClipboard(dataTransfer);
    expect(extracted).toEqual([fakeFile]);
  });
});

describe('composerAttachmentsCache', () => {
  it('正确记录与获取图片附件预览及数据', () => {
    composerAttachmentsCache.clear();
    const mockImage = {
      kind: 'image' as const,
      name: 'screenshot-1.png',
      data: 'BASE64_DATA',
      mediaType: 'image/png',
      previewUrl: 'blob:http://localhost/test',
    };

    composerAttachmentsCache.remember([mockImage]);
    expect(composerAttachmentsCache.get('screenshot-1.png')).toEqual(mockImage);
    expect(composerAttachmentsCache.getPreviewUrl('screenshot-1.png')).toBe('blob:http://localhost/test');
    expect(composerAttachmentsCache.get('unknown.png')).toBeUndefined();
  });
});
