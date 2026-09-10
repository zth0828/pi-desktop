import { describe, expect, it } from 'vitest';
import {
  extractQueueAttachments,
  formatOrderedAttachmentPrompt,
  parseUserMessage,
  stripAttachmentEnvelope,
} from '../../shared/message-attachments';
import { restoreFromText } from '../../src/lib/message-restore';
import type { ComposerAttachment } from '../../src/lib/chat-types';

describe('queue message parsing & display', () => {
  it('从排队消息中剥离信封并提取干净的用户文本与图片/文件附件', () => {
    const rawQueueText = formatOrderedAttachmentPrompt('帮我看下这个截图报错', [
      { kind: 'image', name: 'image.png' },
      { kind: 'file', name: 'error.log', text: 'TypeError: undefined' },
    ]);

    const parsed = parseUserMessage(rawQueueText);
    expect(parsed.text).toBe('帮我看下这个截图报错');
    expect(parsed.attachments).toEqual([
      { index: 1, kind: 'image', name: 'image.png', imageIndex: 1 },
      { index: 2, kind: 'file', name: 'error.log' },
    ]);

    // 状态栏 preview 逻辑
    const preview = parsed.text || parsed.attachments.map((a) => a.name).join(', ') || stripAttachmentEnvelope(rawQueueText);
    expect(preview).toBe('帮我看下这个截图报错');
    expect(preview).not.toContain('<attachments>');
  });

  it('仅包含图片附件的排队消息不会显示原始 XML 标签', () => {
    const rawQueueText = formatOrderedAttachmentPrompt('', [
      { kind: 'image', name: 'image.png' },
    ]);

    const parsed = parseUserMessage(rawQueueText);
    expect(parsed.text).toBe('');
    expect(parsed.attachments).toEqual([
      { index: 1, kind: 'image', name: 'image.png', imageIndex: 1 },
    ]);

    const preview = parsed.text || parsed.attachments.map((a) => a.name).join(', ') || stripAttachmentEnvelope(rawQueueText);
    expect(preview).toBe('image.png');
    expect(preview).not.toContain('<attachments>');
  });
});

describe('extractQueueAttachments (外部文件、侧边栏文件与项目文件)', () => {
  const cwd = '/Users/test/my-project';

  it('正确解析外部文件信封与图片', () => {
    const raw = formatOrderedAttachmentPrompt('外部文件测试', [
      { kind: 'file', name: 'report.pdf', text: 'PDF CONTENT' },
      { kind: 'image', name: 'screenshot.png' },
    ]);

    const { attachments, displayText } = extractQueueAttachments(raw, cwd);
    expect(displayText).toBe('外部文件测试');
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toEqual({
      key: 'att-1-report.pdf',
      index: 1,
      kind: 'file',
      name: 'report.pdf',
      fullName: 'report.pdf',
      imageIndex: undefined,
    });
    expect(attachments[1]).toEqual({
      key: 'att-2-screenshot.png',
      index: 2,
      kind: 'image',
      name: 'screenshot.png',
      fullName: 'screenshot.png',
      imageIndex: 1,
    });
  });

  it('正确解析侧边栏文件与项目文件展开的 <file> 块，并将绝对路径转为相对路径', () => {
    const raw = `<file name="/Users/test/my-project/src/App.tsx">\nconsole.log("hello");\n</file>\n请看这个组件`;

    const { attachments, displayText } = extractQueueAttachments(raw, cwd);
    expect(displayText).toBe('请看这个组件');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toEqual({
      key: 'file-1-/Users/test/my-project/src/App.tsx',
      index: 1,
      kind: 'file',
      name: 'src/App.tsx',
      fullName: '/Users/test/my-project/src/App.tsx',
    });
  });

  it('当仅发送项目文件时，displayText 为空且不泄露 raw XML 标签', () => {
    const raw = `<file name="/Users/test/my-project/src/index.css">\nbody { margin: 0; }\n</file>`;

    const { attachments, displayText } = extractQueueAttachments(raw, cwd);
    expect(displayText).toBe('');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('src/index.css');
    expect(attachments[0].kind).toBe('file');
  });

  it('项目图片文件通过扩展名识别为 image 附件', () => {
    const raw = `<file name="/Users/test/my-project/assets/logo.png"></file>\n查看项目图片`;

    const { attachments, displayText } = extractQueueAttachments(raw, cwd);
    expect(displayText).toBe('查看项目图片');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toEqual({
      key: 'file-1-/Users/test/my-project/assets/logo.png',
      index: 1,
      kind: 'image',
      name: 'assets/logo.png',
      fullName: '/Users/test/my-project/assets/logo.png',
    });
  });

  it('同时存在外部文件信封与项目/侧边栏文件时，按顺序合并展示且不重复', () => {
    const raw = `<attachments>
<attachment index="1" kind="file" name="ext.txt"></attachment>
</attachments>
<file name="ext.txt">
外部内容
</file>
<file name="/Users/test/my-project/src/main.ts">
项目内容
</file>
对比两个文件`;

    const { attachments, displayText } = extractQueueAttachments(raw, cwd);
    expect(displayText).toBe('对比两个文件');
    expect(attachments).toHaveLength(2);
    expect(attachments[0].name).toBe('ext.txt');
    expect(attachments[0].index).toBe(1);
    expect(attachments[1].name).toBe('src/main.ts');
    expect(attachments[1].index).toBe(2);
  });

  it('兼容 macOS /private 前缀路径规范化', () => {
    const macCwd = '/Users/test/project';
    const raw = `<file name="/private/Users/test/project/lib/utils.ts">\nexport const foo = 1;\n</file>`;

    const { attachments } = extractQueueAttachments(raw, macCwd);
    expect(attachments[0].name).toBe('lib/utils.ts');
  });
});

describe('restoreFromText with imageResolver & standalone files', () => {
  it('结合 imageResolver 恢复图片与文件附件', () => {
    const rawQueueText = formatOrderedAttachmentPrompt('测试取回编辑', [
      { kind: 'image', name: 'image.png' },
      { kind: 'file', name: 'notes.txt', text: 'content' },
    ]);

    const mockImage: ComposerAttachment = {
      kind: 'image',
      name: 'image.png',
      data: 'IMAGE_BASE64',
      mediaType: 'image/png',
      previewUrl: 'blob:preview',
    };

    const restored = restoreFromText(rawQueueText, (name) => {
      if (name === 'image.png') return mockImage;
      return undefined;
    });

    expect(restored.text).toBe('测试取回编辑');
    expect(restored.attachments).toEqual([
      mockImage,
      { kind: 'file', name: 'notes.txt', text: 'content' },
    ]);
  });

  it('无信封的独立 <file> 块也能正确恢复为文件附件与图片附件', () => {
    const rawQueueText = `<file name="/path/to/icon.png"></file>\n<file name="/path/to/code.ts">\ncode\n</file>\n查看代码`;

    const mockIcon: ComposerAttachment = {
      kind: 'image',
      name: 'icon.png',
      data: 'ICON_BASE64',
      mediaType: 'image/png',
      previewUrl: 'blob:icon',
    };

    const restored = restoreFromText(rawQueueText, (name) => {
      if (name === 'icon.png' || name === '/path/to/icon.png') return mockIcon;
      return undefined;
    });

    expect(restored.text).toBe('查看代码');
    expect(restored.attachments).toEqual([
      mockIcon,
      { kind: 'file', name: '/path/to/code.ts', text: 'code' },
    ]);
  });
});

