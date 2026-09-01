import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { riskyWorkspaceReason } from '../../electron/utils/workspace-safety';

describe('riskyWorkspaceReason', () => {
  it('把用户主目录判定为 home', () => {
    expect(riskyWorkspaceReason(os.homedir())).toBe('home');
    // 带尾斜杠/重复分隔符的等价写法也应命中
    expect(riskyWorkspaceReason(`${os.homedir()}/`)).toBe('home');
  });

  it('把文件系统根判定为 root', () => {
    expect(riskyWorkspaceReason(path.parse(process.cwd()).root)).toBe('root');
  });

  it('正常项目目录放行', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-ws-safe-'));
    try {
      expect(riskyWorkspaceReason(dir)).toBeNull();
      expect(riskyWorkspaceReason(process.cwd())).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('主目录的直接子目录（项目场景）放行', () => {
    const child = path.join(os.homedir(), 'Desktop');
    // Desktop 不存在时 realpath 失败 → 放行（与「目录不存在」同语义）
    expect(riskyWorkspaceReason(child)).toBeNull();
  });

  it('不存在的路径放行（由 runtime 正常报错）', () => {
    expect(riskyWorkspaceReason(path.join(os.tmpdir(), 'pi-ws-does-not-exist-xyz'))).toBeNull();
  });
});
