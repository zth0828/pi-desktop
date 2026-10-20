import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../electron/utils/electron-store', () => ({
  getElectronStore: vi.fn(async () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('../../electron/main/ipc/host-events', () => ({
  sendHostEvent: vi.fn(),
  sendHostEventToWindow: vi.fn(),
}));

vi.mock('../../electron/services/pi-adapter', async () => {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  return {
    loadPiAdapter: vi.fn(async () => ({
      sessions: {
        list: (cwd: string) => SessionManager.list(cwd),
        listAll: () => SessionManager.listAll(),
        open: (file: string) => SessionManager.open(file),
        create: (cwd: string) => SessionManager.create(cwd),
        forkFrom: (file: string, cwd: string) => SessionManager.forkFrom(file, cwd),
        appendSessionInfo: (doc: any, name: string) => doc?.appendSessionInfo?.(name),
        appendCustomEntry: (doc: any, type: string, data: any) => doc?.appendCustomEntry?.(type, data),
        getEntries: (doc: any) => doc?.getEntries?.() ?? [],
        getSessionDir: (cwd: string) => {
          try {
            return SessionManager.create(cwd).getSessionDir?.();
          } catch {
            return undefined;
          }
        },
      },
      packageVersion: '0.84.2',
    })),
  };
});

const { sessionsApi, probeSuggestedCwd } = await import('../../electron/services/sessions-api');

describe('sessionsApi.relocateProject', () => {
  it('参数不合法或危险路径时安全报错', async () => {
    // 空路径
    const res1 = await sessionsApi.relocateProject({ oldCwd: '', newCwd: '' });
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('invalid');

    // 危险路径 (系统根目录)
    const res2 = await sessionsApi.relocateProject({
      oldCwd: '/fake/old/path',
      newCwd: '/',
    });
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('risky-workspace');
  });

  it('目标目录不存在时拒绝并报错', async () => {
    const res = await sessionsApi.relocateProject({
      oldCwd: '/fake/old/path',
      newCwd: '/nonexistent/target/path/definitely/missing',
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('target directory does not exist');
  });

  it('新旧目录相同时返回 count: 0 的成功空操作', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-relocate-same-'));
    try {
      const res = await sessionsApi.relocateProject({
        oldCwd: tempDir,
        newCwd: tempDir,
      });
      expect(res.success).toBe(true);
      expect(res.count).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('批量改写会话 header 中的 cwd 并搬移文件', async () => {
    const rootTemp = await mkdtemp(path.join(tmpdir(), 'pi-test-relocate-batch-'));
    const agentDir = path.join(rootTemp, 'agent');
    const oldCwd = path.join(rootTemp, 'old-project');
    const newCwd = path.join(rootTemp, 'new-project');

    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await mkdir(newCwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });

    const { SessionManager } = await import('@earendil-works/pi-coding-agent');
    const s1 = SessionManager.create(oldCwd);
    s1.appendMessage({ role: 'user', content: 'test msg 1', timestamp: Date.now() });
    s1.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'reply 1' }],
      api: 'openai',
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);
    const s2 = SessionManager.create(oldCwd);
    s2.appendMessage({ role: 'user', content: 'test msg 2', timestamp: Date.now() });
    s2.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'reply 2' }],
      api: 'openai',
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    try {
      const res = await sessionsApi.relocateProject({
        oldCwd,
        newCwd,
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(2);

      // 验证通过 list(newCwd) 能够直接列出这两个迁移过来的会话
      const newSessions = await SessionManager.list(newCwd);
      expect(newSessions.length).toBe(2);
      expect(newSessions.every((s) => s.cwd === newCwd)).toBe(true);

      // 旧目录已无会话
      const oldSessions = await SessionManager.list(oldCwd);
      expect(oldSessions.length).toBe(0);
    } finally {
      if (previousAgentDir) process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      await rm(rootTemp, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('probeSuggestedCwd', () => {
  it('优先通过 knownCwds 匹配真实存在的同名工作区', async () => {
    const rootTemp = await mkdtemp(path.join(tmpdir(), 'pi-probe-test-'));
    const realTarget = path.join(rootTemp, 'bingking_project', 'pi-desktop');
    await mkdir(realTarget, { recursive: true });

    try {
      const detected = await probeSuggestedCwd(
        '/missing/Desktop/pi-desktop',
        '/missing/Desktop/bingking_project/FlowGate',
        [realTarget, '/other/unrelated/path'],
      );
      expect(detected).toBe(realTarget);
    } finally {
      await rm(rootTemp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('能从当前窗口 fallbackCwd 的父目录推断同级同名目录', async () => {
    const rootTemp = await mkdtemp(path.join(tmpdir(), 'pi-probe-test-'));
    const parentDir = path.join(rootTemp, 'bingking_project');
    const flowGateDir = path.join(parentDir, 'FlowGate');
    const piDesktopDir = path.join(parentDir, 'pi-desktop');
    await mkdir(flowGateDir, { recursive: true });
    await mkdir(piDesktopDir, { recursive: true });

    try {
      const detected = await probeSuggestedCwd(
        '/missing/Desktop/pi-desktop',
        flowGateDir,
        [],
      );
      expect(detected).toBe(piDesktopDir);
    } finally {
      await rm(rootTemp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('能从原父目录的子目录浅层扫描中发现同名项目', async () => {
    const rootTemp = await mkdtemp(path.join(tmpdir(), 'pi-probe-test-'));
    const subFolder = path.join(rootTemp, 'bingking_project');
    const nestedPiDesktop = path.join(subFolder, 'pi-desktop');
    await mkdir(nestedPiDesktop, { recursive: true });

    const missingOldCwd = path.join(rootTemp, 'pi-desktop');

    try {
      const detected = await probeSuggestedCwd(
        missingOldCwd,
        undefined,
        [],
      );
      expect(detected).toBe(nestedPiDesktop);
    } finally {
      await rm(rootTemp, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('sessionsApi.archiveProject 跨目录覆盖', () => {
  it('能够跨目录正确归档和恢复归档不同物理目录下的同 cwd 会话', async () => {
    const rootTemp = await mkdtemp(path.join(tmpdir(), 'pi-test-archive-cross-'));
    const agentDir = path.join(rootTemp, 'agent');
    const projectCwd = path.join(rootTemp, 'project');
    const legacyDir = path.join(agentDir, 'sessions', '--legacy-custom-dir--');

    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await mkdir(projectCwd, { recursive: true });
    await mkdir(legacyDir, { recursive: true });

    const { SessionManager } = await import('@earendil-works/pi-coding-agent');
    const { samePath } = await import('../../electron/utils/same-path');
    const s1 = SessionManager.create(projectCwd);
    s1.appendMessage({ role: 'user', content: 'msg 1', timestamp: Date.now() });
    s1.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'reply 1' }],
      api: 'openai',
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const legacyFile = path.join(legacyDir, 'legacy_session.jsonl');
    const header = JSON.stringify({
      type: 'session',
      version: 3,
      id: 'legacy-id-123',
      timestamp: new Date().toISOString(),
      cwd: projectCwd,
    });
    const msg = JSON.stringify({
      type: 'message',
      id: 'm1',
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'legacy message' }] },
    });
    await writeFile(legacyFile, `${header}\n${msg}\n`, 'utf8');

    try {
      const resArchive = await sessionsApi.archiveProject({ cwd: projectCwd, archived: true });
      expect(resArchive.success).toBe(true);

      const allArchived = await sessionsApi.listAll();
      const s1Row = allArchived.sessions.find((s) => samePath(s.path, (s1 as any).sessionFile));
      const s2Row = allArchived.sessions.find((s) => samePath(s.path, legacyFile));
      expect(s1Row?.archived).toBe(true);
      expect(s2Row?.archived).toBe(true);

      const resUnarchive = await sessionsApi.archiveProject({ cwd: projectCwd, archived: false });
      expect(resUnarchive.success).toBe(true);

      const allRestored = await sessionsApi.listAll();
      const s1RowRestored = allRestored.sessions.find((s) => samePath(s.path, (s1 as any).sessionFile));
      const s2RowRestored = allRestored.sessions.find((s) => samePath(s.path, legacyFile));
      expect(s1RowRestored?.archived).toBe(false);
      expect(s2RowRestored?.archived).toBe(false);

      const legacyContent = await readFile(legacyFile, 'utf8');
      expect(legacyContent).toContain('"pi-desktop.archive"');
      expect(legacyContent).toContain('"archived":false');
    } finally {
      if (previousAgentDir) process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      await rm(rootTemp, { recursive: true, force: true }).catch(() => {});
    }
  });
});
