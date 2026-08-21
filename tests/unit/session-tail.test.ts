import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSessionArchivedFlag } from '../../electron/utils/session-tail';

describe('readSessionArchivedFlag', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'pi-session-tail-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('不存在的文件返回 false', async () => {
    const nonExistent = path.join(tempDir, 'not-found.jsonl');
    expect(await readSessionArchivedFlag(nonExistent)).toBe(false);
  });

  it('空文件返回 false', async () => {
    const emptyFile = path.join(tempDir, 'empty.jsonl');
    await writeFile(emptyFile, '');
    expect(await readSessionArchivedFlag(emptyFile)).toBe(false);
  });

  it('无归档标记的文件返回 false', async () => {
    const file = path.join(tempDir, 'normal.jsonl');
    const lines = [
      JSON.stringify({ type: 'session', id: 's1', version: 3 }),
      JSON.stringify({ type: 'message', id: 'm1', message: { role: 'user', content: 'hello' } }),
    ];
    await writeFile(file, lines.join('\n') + '\n');
    expect(await readSessionArchivedFlag(file)).toBe(false);
  });

  it('单条 archived: true 返回 true', async () => {
    const file = path.join(tempDir, 'archived.jsonl');
    const lines = [
      JSON.stringify({ type: 'session', id: 's1', version: 3 }),
      JSON.stringify({ type: 'message', id: 'm1', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: true } }),
    ];
    await writeFile(file, lines.join('\n') + '\n');
    expect(await readSessionArchivedFlag(file)).toBe(true);
  });

  it('单条 archived: false 返回 false', async () => {
    const file = path.join(tempDir, 'unarchived.jsonl');
    const lines = [
      JSON.stringify({ type: 'session', id: 's1', version: 3 }),
      JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: false } }),
    ];
    await writeFile(file, lines.join('\n') + '\n');
    expect(await readSessionArchivedFlag(file)).toBe(false);
  });

  it('多次归档/取消归档以最后一条为准', async () => {
    const file = path.join(tempDir, 'toggle.jsonl');
    const lines = [
      JSON.stringify({ type: 'session', id: 's1', version: 3 }),
      JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: true } }),
      JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: false } }),
    ];
    await writeFile(file, lines.join('\n') + '\n');
    expect(await readSessionArchivedFlag(file)).toBe(false);

    lines.push(JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: true } }));
    await writeFile(file, lines.join('\n') + '\n');
    expect(await readSessionArchivedFlag(file)).toBe(true);
  });

  it('末尾有不完整/损坏的写入时能跳过并读取前面的合法归档标记', async () => {
    const file = path.join(tempDir, 'corrupted-tail.jsonl');
    const lines = [
      JSON.stringify({ type: 'session', id: 's1', version: 3 }),
      JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: true } }),
    ];
    const content = lines.join('\n') + '\n{"type":"message","id":"partial-crash...';
    await writeFile(file, content);
    expect(await readSessionArchivedFlag(file)).toBe(true);
  });

  it('大文件（>8KB）尾部归档标记可正常读取', async () => {
    const file = path.join(tempDir, 'large.jsonl');
    const lines: string[] = [JSON.stringify({ type: 'session', id: 's1', version: 3 })];
    // 构造约 20KB 的普通消息
    for (let i = 0; i < 200; i += 1) {
      lines.push(JSON.stringify({
        type: 'message',
        id: `msg-${i}`,
        message: { role: 'user', content: 'padding data '.repeat(10) },
      }));
    }
    lines.push(JSON.stringify({ type: 'custom', customType: 'pi-desktop.archive', data: { archived: true } }));
    await writeFile(file, lines.join('\n') + '\n');
    expect(await readSessionArchivedFlag(file)).toBe(true);
  });
});
