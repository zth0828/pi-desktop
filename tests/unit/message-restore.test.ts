import { describe, expect, it } from 'vitest';
import { restoreFromText, restoreToComposer } from '../../src/lib/message-restore';
import { formatOrderedAttachmentPrompt } from '../../shared/message-attachments';
import type { ChatMessage } from '../../src/lib/chat-types';

describe('restoreFromText', () => {
  it('剥离信封并提取文件附件', () => {
    const text = formatOrderedAttachmentPrompt('Please check this', [
      { kind: 'file', name: 'config.json', text: '{"key": "val"}' },
    ]);
    const restored = restoreFromText(text);
    expect(restored.text).toBe('Please check this');
    expect(restored.attachments).toEqual([
      { kind: 'file', name: 'config.json', text: '{"key": "val"}' },
    ]);
  });

  it('纯文本消息无附件', () => {
    const restored = restoreFromText('Just a question');
    expect(restored.text).toBe('Just a question');
    expect(restored.attachments).toEqual([]);
  });
});

describe('restoreToComposer', () => {
  it('从 ChatMessage 还原带图片与文件的输入框草稿', () => {
    const promptText = formatOrderedAttachmentPrompt('Analyze these files', [
      { kind: 'image', name: 'graph.png' },
      { kind: 'file', name: 'data.csv', text: 'col1,col2\n1,2' },
      { kind: 'image', name: 'flow.png' },
    ]);

    const message: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: promptText },
        { type: 'image', data: 'BASE64_GRAPH', mimeType: 'image/png' },
        { type: 'image', data: 'BASE64_FLOW', mimeType: 'image/jpeg' },
      ],
      raw: null,
    };

    const restored = restoreToComposer(message);
    expect(restored.text).toBe('Analyze these files');
    expect(restored.attachments).toEqual([
      {
        kind: 'image',
        name: 'graph.png',
        data: 'BASE64_GRAPH',
        mediaType: 'image/png',
        previewUrl: 'data:image/png;base64,BASE64_GRAPH',
      },
      {
        kind: 'file',
        name: 'data.csv',
        text: 'col1,col2\n1,2',
      },
      {
        kind: 'image',
        name: 'flow.png',
        data: 'BASE64_FLOW',
        mediaType: 'image/jpeg',
        previewUrl: 'data:image/jpeg;base64,BASE64_FLOW',
      },
    ]);
  });

  it('兼容早期 source 嵌套格式与无 manifest 遗留消息', () => {
    const message: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Legacy image question' },
        {
          type: 'image',
          ...({ source: { data: 'OLD_BASE64', mediaType: 'image/webp' } } as Record<string, unknown>),
        },
      ],
      raw: null,
    };

    const restored = restoreToComposer(message);
    expect(restored.text).toBe('Legacy image question');
    expect(restored.attachments).toEqual([
      {
        kind: 'image',
        name: 'image-1.png',
        data: 'OLD_BASE64',
        mediaType: 'image/webp',
        previewUrl: 'data:image/webp;base64,OLD_BASE64',
      },
    ]);
  });
});
