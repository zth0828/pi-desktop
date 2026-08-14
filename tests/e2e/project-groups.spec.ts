// 侧栏项目分组 + 跨项目切换会话的 E2E。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './fixtures/electron';
import { piTestEnv } from '../helpers/pi-prefix';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspaceA: string;
let workspaceB: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock timeout')), 10_000);
  });
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  workspaceA = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-proj-alpha-'));
  workspaceB = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-proj-beta-'));
  await writeFile(
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
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }));
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspaceA, { recursive: true, force: true });
  await rm(workspaceB, { recursive: true, force: true });
});

test.afterAll(() => {
  mock?.kill();
});

/** 直接用 SDK 在 workspaceB 里造一条会话（验证跨项目分组/切换的数据源） */
async function seedSessionInB(text: string) {
  const { piPackageRoot } = piTestEnv();
  const entry = path.join(piPackageRoot, 'dist/index.js');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sdk = (await import(pathToFileURL(entry).href)) as typeof import('@earendil-works/pi-coding-agent');
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
  });
  const [model] = await modelRuntime.getAvailable();
  const { session } = await sdk.createAgentSession({
    cwd: workspaceB,
    agentDir,
    sessionManager: sdk.SessionManager.create(workspaceB),
    settingsManager: sdk.SettingsManager.create(workspaceB, agentDir),
    modelRuntime,
    model,
    thinkingLevel: 'off',
  });
  await session.prompt(text);
  session.dispose();
}

/** 用 pi SessionManager 原生格式快速造大量会话，不调用模型。 */
async function seedManySessions(cwd: string, count: number) {
  const { piPackageRoot } = piTestEnv();
  const entry = path.join(piPackageRoot, 'dist/index.js');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sdk = (await import(pathToFileURL(entry).href)) as typeof import('@earendil-works/pi-coding-agent');
  const sessionModulePath = path.join(
    piPackageRoot,
    'dist/core/session-manager.js',
  );
  const sessionModule = (await import(pathToFileURL(sessionModulePath).href)) as {
    getDefaultSessionDir: (targetCwd: string, targetAgentDir?: string) => string;
  };
  const sessionDir = sessionModule.getDefaultSessionDir(cwd, agentDir);
  for (let index = 1; index <= count; index += 1) {
    const session = sdk.SessionManager.create(cwd, sessionDir);
    session.appendMessage({
      role: 'user',
      content: `bulk session ${String(index).padStart(2, '0')}`,
      timestamp: Date.now() + index,
    });
    session.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'seeded' }],
      api: 'openai-completions',
      provider: 'mock',
      model: 'mock-1',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now() + index,
    });
    session.appendSessionInfo(`Bulk session ${String(index).padStart(2, '0')}`);
  }
}

test('侧栏按项目分组折叠，跨项目点击切换会话', async ({ launchElectronApp }) => {
  await seedSessionInB('这是 beta 项目的会话');

  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspaceA },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  // 在 A 项目发一条，产生 A 的会话
  await page.getByTestId('chat-input').fill('alpha 项目的对话');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });

  const nameA = path.basename(workspaceA);
  const nameB = path.basename(workspaceB);
  // 两个项目组都出现；当前项目（A）默认展开，B 默认折叠
  await expect(page.getByTestId(`session-group-header-${nameA}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`session-group-header-${nameB}`)).toBeVisible();
  await expect(page.getByText('这是 beta 项目的会话')).not.toBeVisible();

  // 展开 B 组并点击其中的会话 → 跨项目切换
  await page.getByTestId(`session-group-header-${nameB}`).click();
  const target = page.getByText('这是 beta 项目的会话');
  await expect(target).toBeVisible();
  await target.click();

  // 聊天区恢复 B 的会话内容，头部工作目录切到 B
  await expect(page.getByTestId('message-user').first()).toContainText('这是 beta 项目的会话', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('chat-workspace')).toContainText(path.basename(workspaceB));
  await expect(page.getByTestId('chat-workspace')).toHaveAttribute('title', workspaceB);
});

test('大量会话按项目分批显示，侧栏可独立滚动', async ({ launchElectronApp }) => {
  await seedManySessions(workspaceA, 25);

  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspaceA },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  const nameA = path.basename(workspaceA);
  const group = page.getByTestId(`session-group-${nameA}`);
  const groupHeader = page.getByTestId(`session-group-header-${nameA}`);
  if ((await groupHeader.getAttribute('aria-expanded')) === 'false') await groupHeader.click();
  await expect(group.locator('.sidebar-session-row')).toHaveCount(10, { timeout: 15_000 });

  const showMore = page.getByTestId(`session-group-show-more-${nameA}`);
  // Runtime startup creates the current empty session alongside the 25 fixtures.
  await expect(showMore).toContainText('16 remaining');
  await showMore.click();
  await expect(group.locator('.sidebar-session-row')).toHaveCount(20);
  await expect(showMore).toContainText('6 remaining');
  await showMore.click();
  await expect(group.locator('.sidebar-session-row')).toHaveCount(26);
  await expect(showMore).toHaveCount(0);

  const sidebarSessions = page.getByTestId('sidebar-sessions');
  await expect.poll(() => sidebarSessions.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await sidebarSessions.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => sidebarSessions.evaluate((element) => element.scrollTop > 0)).toBe(true);
  await expect(page.getByTestId('nav-settings')).toBeVisible();

  const bottomRow = group.locator('.sidebar-session-row').last();
  await bottomRow.scrollIntoViewIfNeeded();
  const bottomSessionButton = bottomRow.locator('[data-testid^="sidebar-session-"]').first();
  const bottomSessionTestId = await bottomSessionButton.getAttribute('data-testid');
  const bottomSessionId = bottomSessionTestId?.replace('sidebar-session-', '');
  expect(bottomSessionId).toBeTruthy();
  await bottomRow.click({ button: 'right' });
  const bottomMenu = page.getByTestId(`session-context-menu-${bottomSessionId}`);
  await expect(bottomMenu).toBeVisible();
  const bottomMenuBox = await bottomMenu.boundingBox();
  const viewport = await page.evaluate<{ width: number; height: number }>(
    '({ width: window.innerWidth, height: window.innerHeight })',
  );
  expect(bottomMenuBox).not.toBeNull();
  expect(bottomMenuBox!.y + bottomMenuBox!.height).toBeLessThanOrEqual(viewport.height);
});
