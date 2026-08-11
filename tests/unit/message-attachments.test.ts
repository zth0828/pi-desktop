import { describe, expect, it } from 'vitest';
import {
  formatOrderedAttachmentPrompt,
  parseUserMessage,
} from '../../shared/message-attachments';

describe('ordered message attachments', () => {
  it('preserves mixed upload order and maps image indexes to Pi image order', () => {
    const prompt = formatOrderedAttachmentPrompt('Inspect these.', [
      { kind: 'image', name: 'first.png' },
      { kind: 'file', name: 'notes.txt', text: 'alpha' },
      { kind: 'image', name: 'second.png' },
    ]);

    expect(prompt).toContain('<attachment index="1" kind="image" name="first.png" image-index="1"></attachment>');
    expect(prompt).toContain('<attachment index="2" kind="file" name="notes.txt"></attachment>');
    expect(prompt).toContain('<attachment index="3" kind="image" name="second.png" image-index="2"></attachment>');
    expect(prompt).toContain('<file name="notes.txt">\nalpha\n</file>');

    const parsed = parseUserMessage(prompt);
    expect(parsed.text).toBe('Inspect these.');
    expect(parsed.attachments).toEqual([
      { index: 1, kind: 'image', name: 'first.png', imageIndex: 1 },
      { index: 2, kind: 'file', name: 'notes.txt' },
      { index: 3, kind: 'image', name: 'second.png', imageIndex: 2 },
    ]);
    expect(parsed.files).toEqual([{ name: 'notes.txt', text: 'alpha' }]);
  });

  it('keeps legacy file blocks separate from visible message text', () => {
    const parsed = parseUserMessage('<file name="legacy.md">\n# title\n</file>\nExplain it');
    expect(parsed.text).toBe('Explain it');
    expect(parsed.attachments).toEqual([]);
    expect(parsed.files).toEqual([{ name: 'legacy.md', text: '# title' }]);
  });

  it('escapes manifest names without changing the Pi file block payload', () => {
    const parsed = parseUserMessage(formatOrderedAttachmentPrompt('Go', [
      { kind: 'image', name: 'a & b.png' },
    ]));
    expect(parsed.attachments[0].name).toBe('a & b.png');
  });
});
