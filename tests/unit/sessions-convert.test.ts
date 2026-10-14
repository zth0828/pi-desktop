import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionsApi } from '../../electron/services/sessions-api';
import { ensureScratchpadSessionDir } from '../../electron/utils/scratchpad';

describe('sessionsApi.convertToProject', () => {
  it('参数不合法或危险路径时安全报错', async () => {
    // 空 payload
    const res1 = await sessionsApi.convertToProject({ sessionPath: '', targetCwd: '' });
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('invalid');

    // 危险路径 (系统目录)
    const res2 = await sessionsApi.convertToProject({
      sessionPath: '/fake/session.jsonl',
      targetCwd: '/',
    });
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('risky-workspace');
  });

  it('会话文件不存在时安全报错', async () => {
    const res = await sessionsApi.convertToProject({
      sessionPath: '/nonexistent/path/session.jsonl',
      targetCwd: '/tmp/target-project',
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('session file not found');
  });

  it('原会话为 scratchpad 时将生成的文件复制到目标工程并更新 header cwd', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-convert-'));
    const scratchpadCwd = await ensureScratchpadSessionDir('test_session_convert');
    const targetCwd = path.join(tempDir, 'my-new-project');

    // 在草稿工作区中模拟用户或 Agent 生成的代码文件
    await writeFile(path.join(scratchpadCwd, 'index.ts'), 'console.log("hello")', 'utf8');
    await writeFile(path.join(scratchpadCwd, 'note.txt'), 'scratchpad note', 'utf8');

    // 创建测试会话文件，header 指向 scratchpadCwd
    const sessionFile = path.join(tempDir, 'session.jsonl');
    const header = {
      type: 'session',
      version: 1,
      id: 'session-scratchpad-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: scratchpadCwd,
    };
    await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');

    // 调用 convertToProject
    // 注意：单元测试中未启动真实 pi runtime，在完成文件复制与 header 改写后，switchSessionImpl 会返回 'session not started'
    const res = await sessionsApi.convertToProject({
      sessionPath: sessionFile,
      targetCwd,
    });

    // 验证文件已经被成功复制到 targetCwd
    const indexContent = await readFile(path.join(targetCwd, 'index.ts'), 'utf8');
    expect(indexContent).toBe('console.log("hello")');

    const noteContent = await readFile(path.join(targetCwd, 'note.txt'), 'utf8');
    expect(noteContent).toBe('scratchpad note');

    // 验证 .gitignore 没有被无差别覆盖到目标项目
    // (scratchpad 内有系统生成的 .gitignore)
    const gitignoreExists = await readFile(path.join(targetCwd, '.gitignore'), 'utf8').catch(() => null);
    expect(gitignoreExists).toBeNull();

    // 验证 session 文件 header 中的 cwd 已被原子改写为 targetCwd
    const updatedContent = await readFile(sessionFile, 'utf8');
    const updatedHeader = JSON.parse(updatedContent.trim());
    expect(updatedHeader.cwd).toBe(targetCwd);

    await rm(tempDir, { recursive: true, force: true });
    await rm(scratchpadCwd, { recursive: true, force: true }).catch(() => {});
  });
});
