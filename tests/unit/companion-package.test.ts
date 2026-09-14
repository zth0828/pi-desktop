import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { companionInternal } from '../../electron/services/packages-api';

describe('companion-package (内置伴生扩展路径与打包解析)', () => {
  it('正确解析 ask-question 随包内置资源路径并确认文件存在', () => {
    const sourcePath = companionInternal.getBundledCompanionSource('ask-question');
    expect(sourcePath).toBeTruthy();
    expect(existsSync(sourcePath!)).toBe(true);
    expect(sourcePath!.endsWith('ask-question.ts')).toBe(true);
  });

  it('对于不存在的扩展 id 返回 null', () => {
    const sourcePath = companionInternal.getBundledCompanionSource('non-existent-companion');
    expect(sourcePath).toBeNull();
  });

  it('正确生成目标 agent 扩展目录路径', () => {
    const mockAgentDir = '/tmp/mock-agent-dir';
    const targetPath = companionInternal.getCompanionTargetPath(mockAgentDir, 'ask-question');
    expect(targetPath).toBe(path.join(mockAgentDir, 'extensions', 'ask-question.ts'));
  });

  it('模拟安装与卸载流程：文件复制与移除', () => {
    const tmpDir = path.join(os.tmpdir(), `companion-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const targetPath = companionInternal.getCompanionTargetPath(tmpDir, 'ask-question');
      expect(existsSync(targetPath)).toBe(false);

      // 模拟启用：复制内置源码
      const sourcePath = companionInternal.getBundledCompanionSource('ask-question');
      expect(sourcePath).toBeTruthy();
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, 'export default {};');
      expect(existsSync(targetPath)).toBe(true);

      // 模拟移除：删除文件
      rmSync(targetPath);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
