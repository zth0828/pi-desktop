import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizePreviewablePath,
  previewableExternalFilesFromMessages,
} from '../../electron/utils/previewable-files';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('previewableExternalFilesFromMessages', () => {
  it('restores read/edit/write absolute paths outside cwd from historical tool calls', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pi-preview-root-'));
    const external = mkdtempSync(path.join(tmpdir(), 'pi-preview-external-'));
    roots.push(root, external);
    const files = ['read.txt', 'edit.txt', 'write.txt'].map((name) => path.join(external, name));
    for (const file of files) writeFileSync(file, nameFor(file));

    const result = previewableExternalFilesFromMessages([
      { role: 'assistant', content: files.map((file, index) => ({
        type: 'toolCall',
        name: ['read', 'edit', 'write'][index],
        arguments: index === 1 ? { file_path: file } : { path: file },
      })) },
    ], root);

    expect(result).toEqual(new Set(files.map(normalizePreviewablePath)));
  });

  it('ignores relative, in-workspace, bash, and non-assistant paths', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pi-preview-root-'));
    const external = mkdtempSync(path.join(tmpdir(), 'pi-preview-external-'));
    roots.push(root, external);
    mkdirSync(path.join(root, 'src'));
    const inside = path.join(root, 'src', 'inside.txt');
    const outside = path.join(external, 'outside.txt');
    writeFileSync(inside, 'inside');
    writeFileSync(outside, 'outside');

    const result = previewableExternalFilesFromMessages([
      { role: 'assistant', content: [
        { type: 'toolCall', name: 'read', arguments: { path: 'relative.txt' } },
        { type: 'toolCall', name: 'read', arguments: { path: inside } },
        { type: 'toolCall', name: 'bash', arguments: { path: outside } },
      ] },
      { role: 'user', content: [{ type: 'toolCall', name: 'read', arguments: { path: outside } }] },
    ], root);

    expect(result.size).toBe(0);
  });

  it('normalizes a missing write target through its real parent directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pi-preview-root-'));
    roots.push(root);
    const lexical = path.join(root, 'missing', 'new.txt');
    const normalized = normalizePreviewablePath(lexical);
    expect(normalized).toBe(path.join(normalizePreviewablePath(root), 'missing', 'new.txt'));
  });
});

function nameFor(file: string): string {
  return path.basename(file);
}
