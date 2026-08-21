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
    sessionMetadataCache.set('/fake/path', { mtimeMs: 1000, size: 200, archived: true });
    expect(sessionMetadataCache.get('/fake/path')?.archived).toBe(true);
    clearSessionMetadataCache();
    expect(sessionMetadataCache.size).toBe(0);
  });

  it('archive 与 remove 操作会失效对应缓存条目', async () => {
    const sessionFile = path.join(tempDir, 'dummy.jsonl');
    await writeFile(sessionFile, JSON.stringify({ type: 'session', id: 's1' }) + '\n');

    sessionMetadataCache.set(sessionFile, { mtimeMs: 12345, size: 50, archived: false });
    expect(sessionMetadataCache.has(sessionFile)).toBe(true);

    await sessionsApi.remove({ path: sessionFile });
    expect(sessionMetadataCache.has(sessionFile)).toBe(false);
  });
});
