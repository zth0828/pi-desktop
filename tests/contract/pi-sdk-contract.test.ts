// L2 契约测试：壳依赖的 pi SDK 封装点全链路验证（docs §7.1 L2）。
// 真 pi（隔离 npm prefix）+ mock provider（不烧真实 API quota）。
// 覆盖：runtime 工厂模式、bindExtensions（无头）、prompt/事件序列、
// abort 中断、SessionManager 持久化与 list、newSession 替换。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapPiSessionEvent, type PiChatEvent } from '@shared/pi-event-map';
import { piTestEnv } from '../helpers/pi-prefix';

type PiSdk = typeof import('@earendil-works/pi-coding-agent');

let sdk: PiSdk;
let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;

beforeAll(async () => {
  const { piPackageRoot } = piTestEnv();
  const entry = path.join(piPackageRoot, 'dist/index.js');
  sdk = (await import(pathToFileURL(entry).href)) as PiSdk;

  mock = spawn(process.execPath, [resolveFixture('mock-openai-server.mjs')]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock server timeout')), 10_000);
  });

  agentDir = mkdtempSync(path.join(tmpdir(), 'pi-contract-agent-'));
  workspace = mkdtempSync(path.join(tmpdir(), 'pi-contract-workspace-'));
  // SessionManager.create(cwd) 的默认 sessionDir 走 getAgentDir()（读环境变量），
  // 不设会把测试会话写进真实 ~/.pi/agent
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          apiKey: 'mock-key',
          models: [
            {
              id: 'mock-1',
              name: 'Mock 1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        },
      },
    }),
  );
});

afterAll(() => {
  mock?.kill();
});

function resolveFixture(name: string): string {
  return path.join(__dirname, '../fixtures', name);
}

// 与 electron/services/pi-runtime-api.ts 完全相同的 runtime 创建路径
async function createRuntimeUnderTest() {
  const createFactory = async ({ cwd, sessionManager, sessionStartEvent }: never) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir });
    return {
      ...(await sdk.createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  return sdk.createAgentSessionRuntime(createFactory as never, {
    cwd: workspace,
    agentDir,
    sessionManager: sdk.SessionManager.create(workspace),
  });
}

describe('pi SDK 契约（pi 0.83.x + mock provider）', () => {
  it('runtime 创建 + bindExtensions（无头 print 模式）+ 事件映射全链路', async () => {
    const runtime = await createRuntimeUnderTest();
    const session = runtime.session;
    expect(session.sessionId).toBeTruthy();

    await session.bindExtensions({
      mode: 'print',
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: async (options) => runtime.newSession(options),
        fork: async (entryId, options) => {
          const r = await runtime.fork(entryId, options);
          return { cancelled: r.cancelled };
        },
        navigateTree: async (targetId, options) => {
          const r = await session.navigateTree(targetId, options);
          return { cancelled: r.cancelled };
        },
        switchSession: async (p, options) => runtime.switchSession(p, options),
        reload: async () => {
          await session.reload();
        },
      },
      onError: () => {},
    });

    const mapped: PiChatEvent[] = [];
    session.subscribe((ev) => {
      const m = mapPiSessionEvent(ev);
      if (m) mapped.push(m);
    });

    await session.prompt('USE_TOOL_LS now');
    const types = mapped.map((e) => e.type);
    expect(types).toContain('run.started');
    expect(types).toContain('assistant.partial');
    expect(types).toContain('tool.execution.started');
    expect(types).toContain('tool.execution.completed');
    expect(types).toContain('run.ended');
    // 工具真的执行了（ls 结果回显）
    const lastAssistant = [...mapped].reverse().find((e) => e.type === 'message.ended');
    expect(JSON.stringify(lastAssistant)).toContain('FINAL:');

    // 会话持久化：SessionManager.list 能找到（M4 依赖点）
    const sessions = await sdk.SessionManager.list(workspace);
    expect(sessions.length).toBeGreaterThan(0);

    // newSession 替换
    await runtime.newSession();
    expect(runtime.session.sessionId).not.toBe(session.sessionId);
    runtime.dispose();
  });

  it('abort 中断慢速流：pi 状态回到非流式且无悬挂', async () => {
    const runtime = await createRuntimeUnderTest();
    const session = runtime.session;
    let ended = false;
    session.subscribe((ev) => {
      if (ev.type === 'agent_end') ended = true;
    });

    const promptPromise = session.prompt('SLOW stream please');
    // 等流式起来再 abort
    await new Promise((r) => setTimeout(r, 500));
    expect(session.isStreaming).toBe(true);
    await session.abort();
    await promptPromise.catch(() => {});
    await session.waitForIdle().catch(() => {});
    expect(session.isStreaming).toBe(false);
    expect(ended).toBe(true);
    runtime.dispose();
  });

  it('斜杠命令映射依赖的 SDK 面：setSessionName / getSessionStats / reload / 扩展命令清单', async () => {
    const runtime = await createRuntimeUnderTest();
    const session = runtime.session;
    // 扩展命令清单（/ 补全聚合来源；无扩展时为空数组）
    expect(Array.isArray(session.extensionRunner.getRegisteredCommands())).toBe(true);
    // /name：setSessionName → SessionManager.getSessionName 读回
    session.setSessionName('contract-name');
    expect(session.sessionManager.getSessionName()).toBe('contract-name');
    // /session：getSessionStats 的字段形状
    const stats = session.getSessionStats();
    expect(stats.sessionId).toBe(session.sessionId);
    expect(stats.totalMessages).toBeGreaterThanOrEqual(0);
    expect(stats.tokens.total).toBeGreaterThanOrEqual(0);
    // /reload：全量重载资源（无头模式可用）
    await session.reload();
    runtime.dispose();
  });
});
