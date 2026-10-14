import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanScratchpadSessionDir,
  ensureScratchpadSessionDir,
  getScratchpadRootDir,
  isScratchpadPath,
} from '../../electron/utils/scratchpad';

describe('scratchpad (草稿沙箱工具)', () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(path.join(tmpdir(), 'pi-scratchpad-test-'));
    process.env.PI_CODING_AGENT_DIR = path.join(tempBaseDir, 'agent');
  });

  afterEach(async () => {
    delete process.env.PI_CODING_AGENT_DIR;
    await rm(tempBaseDir, { recursive: true, force: true }).catch(() => {});
  });

  it('正确解析 scratchpad 根路径，与 agent 目录保持平级', () => {
    const root = getScratchpadRootDir();
    expect(root).toBe(path.join(tempBaseDir, 'scratchpad'));
  });

  it('正确判定路径是否属于 scratchpad 范围', () => {
    const root = getScratchpadRootDir();
    expect(isScratchpadPath(root)).toBe(true);
    expect(isScratchpadPath(path.join(root, 's_123'))).toBe(true);
    expect(isScratchpadPath(path.join(root, 's_123', 'subfile.ts'))).toBe(true);

    expect(isScratchpadPath(tempBaseDir)).toBe(false);
    expect(isScratchpadPath(path.join(tempBaseDir, 'agent'))).toBe(false);
    expect(isScratchpadPath('/Users/bingking/Desktop/project')).toBe(false);
    expect(isScratchpadPath(null)).toBe(false);
  });

  it('ensureScratchpadSessionDir 自动创建子目录与默认 .gitignore', async () => {
    const sessionDir = await ensureScratchpadSessionDir('test-session-1');
    expect(existsSync(sessionDir)).toBe(true);

    const gitignorePath = path.join(sessionDir, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    expect(readFileSync(gitignorePath, 'utf8')).toContain('node_modules');
  });

  it('cleanScratchpadSessionDir 安全清理子沙箱且不误删根目录', async () => {
    const root = getScratchpadRootDir();
    const sessionDir = await ensureScratchpadSessionDir('test-session-to-clean');
    expect(existsSync(sessionDir)).toBe(true);

    await cleanScratchpadSessionDir(sessionDir);
    expect(existsSync(sessionDir)).toBe(false);

    // 根目录不能被误删
    await cleanScratchpadSessionDir(root);
    expect(existsSync(root)).toBe(true);
  });
});
