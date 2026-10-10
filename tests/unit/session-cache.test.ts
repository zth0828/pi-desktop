import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSessionMetadataCache, sessionMetadataCache, sessionsApi } from '../../electron/services/sessions-api';

describe('sessionsApi metadata cache', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearSessionMetadataCache();
    tempDir = await mkdtemp(path.join(tmpdir(), 'pi-session-cache-test-'));
  });

  afterEach(async () => {
    clearSessionMetadataCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('缓存初始为空，在 sessionMetadataCache 中可以手动操作与清理', () => {
    expect(sessionMetadataCache.size).toBe(0);
    sessionMetadataCache.set('/fake/path', { mtimeMs: 1000, size: 200, archived: true, pinned: false });
    expect(sessionMetadataCache.get('/fake/path')?.archived).toBe(true);
    expect(sessionMetadataCache.get('/fake/path')?.pinned).toBe(false);
    clearSessionMetadataCache();
    expect(sessionMetadataCache.size).toBe(0);
  });

  it('archive 与 remove 操作会失效对应缓存条目', async () => {
    const sessionFile = path.join(tempDir, 'dummy.jsonl');
    await writeFile(sessionFile, JSON.stringify({ type: 'session', id: 's1' }) + '\n');

    sessionMetadataCache.set(sessionFile, { mtimeMs: 12345, size: 50, archived: false, pinned: true });
    expect(sessionMetadataCache.has(sessionFile)).toBe(true);

    await sessionsApi.remove({ path: sessionFile });
    expect(sessionMetadataCache.has(sessionFile)).toBe(false);
  });

  it('remove 操作通过 samePath 失效不同路径形态（如额外反斜杠或大小写）的缓存条目', async () => {
    const sessionFile = path.join(tempDir, 'dummy-path.jsonl');
    await writeFile(sessionFile, JSON.stringify({ type: 'session', id: 's2' }) + '\n');

    sessionMetadataCache.set(sessionFile, { mtimeMs: 12345, size: 50, archived: false, pinned: true });
    expect(sessionMetadataCache.size).toBe(1);

    // 传入带冗余分隔符或不同格式的等价路径
    await sessionsApi.remove({ path: `${sessionFile}` });
    expect(sessionMetadataCache.size).toBe(0);
  });

  it('remove 拦截空路径、纯空白、Windows 设备路径与目录路径', async () => {
    expect(await sessionsApi.remove({ path: '' })).toEqual({ success: false, error: 'invalid session path' });
    expect(await sessionsApi.remove({ path: '   ' })).toEqual({ success: false, error: 'invalid session path' });
    expect(await sessionsApi.remove({ path: 'CON' })).toEqual({ success: false, error: 'device paths are not allowed' });
    expect(await sessionsApi.remove({ path: tempDir })).toEqual({ success: false, error: 'session path cannot be a directory' });
  });

  it('rename, fork, archive, pin 与 exportHtml 拦截非法空会话路径', async () => {
    expect(await sessionsApi.rename({ path: '', name: 'new-name' })).toEqual({ success: false, error: 'invalid session path' });
    expect(await sessionsApi.fork({ path: '' })).toEqual({ success: false, error: 'invalid session path' });
    expect(await sessionsApi.archive({ path: '', archived: true })).toEqual({ success: false, error: 'invalid session path' });
    expect(await sessionsApi.pin({ path: '', pinned: true })).toEqual({ success: false, error: 'invalid session path' });
    expect(await sessionsApi.exportHtml({ path: '' })).toEqual({ success: false, error: 'invalid session path' });
  });
});
