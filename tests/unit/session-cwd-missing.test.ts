import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { updateSessionHeaderCwd } from '../../electron/services/sessions-api';

describe('session-cwd-missing & persistence', () => {
  it('updateSessionHeaderCwd 安全改写会话 header 的 cwd 并保留后续内容', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-header-'));
    const sessionFile = path.join(tempDir, 'test-session.jsonl');

    const originalHeader = {
      type: 'session',
      version: 1,
      id: 'session-123',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/path/to/old-project',
      parentSession: undefined,
    };
    const messageEntry = {
      type: 'message',
      id: 'msg-1',
      parentId: null,
      message: { role: 'user', content: 'hello world' },
    };

    const initialContent = `${JSON.stringify(originalHeader)}\n${JSON.stringify(messageEntry)}\n`;
    await writeFile(sessionFile, initialContent, 'utf8');

    const newCwd = '/path/to/new-project';
    await updateSessionHeaderCwd(sessionFile, newCwd);

    const updatedContent = await readFile(sessionFile, 'utf8');
    const lines = updatedContent.trim().split('\n');
    expect(lines.length).toBe(2);

    const updatedHeader = JSON.parse(lines[0]) as typeof originalHeader;
    expect(updatedHeader.cwd).toBe(newCwd);
    expect(updatedHeader.id).toBe('session-123');
    expect(updatedHeader.version).toBe(1);

    const readEntry = JSON.parse(lines[1]) as typeof messageEntry;
    expect(readEntry.id).toBe('msg-1');
    expect(readEntry.message.content).toBe('hello world');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('updateSessionHeaderCwd 当 cwd 已经一致时幂等早退', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-header-'));
    const sessionFile = path.join(tempDir, 'test-session.jsonl');

    const originalHeader = {
      type: 'session',
      version: 1,
      id: 'session-456',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/path/to/same-project',
    };
    await writeFile(sessionFile, `${JSON.stringify(originalHeader)}\n`, 'utf8');

    await updateSessionHeaderCwd(sessionFile, '/path/to/same-project');

    const content = await readFile(sessionFile, 'utf8');
    const updatedHeader = JSON.parse(content.trim()) as typeof originalHeader;
    expect(updatedHeader.cwd).toBe('/path/to/same-project');

    await rm(tempDir, { recursive: true, force: true });
  });
});
