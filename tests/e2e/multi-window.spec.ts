// 多窗口 E2E：真 pi + mock provider，不烧 API quota。
// 1) 右键会话「Open in separate window」→ 第二窗口加载同会话历史；重复打开聚焦复用、不新增窗口；
// 2) 主窗口与独立窗口各发 SLOW_ECHO 并发流式，事件按 sessionId 过滤、互不串台；
// 3) 关闭独立窗口 → runtime 保活，主窗口切回该会话，历史完好且可继续对话。
// 模式同 sessions.spec.ts：每用例独立 agentDir，mock 走 tests/fixtures/mock-openai-server.mjs。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock server timeout')), 10_000);
  });

  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
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
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }),
  );
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
});

const launchOptions = () => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace },
});

/** 等会话启动（模型选择器/徽标出现 = runtime 就绪） */
async function waitSessionReady(page: Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 发一条消息并等 mock 回复落地（保证会话文件已写入） */
async function sendAndWaitReply(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

/** 右键侧栏会话行 →「Open in separate window」，返回新窗口 Page */
async function openDetachedWindow(
  app: ElectronApplication,
  page: Page,
  sessionText: string,
): Promise<Page> {
  const row = page.locator('.sidebar-session-row').filter({ hasText: sessionText });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  const sessionTestId = await sessionButton.getAttribute('data-testid');
  const sessionId = sessionTestId?.replace('sidebar-session-', '');
  expect(sessionId).toBeTruthy();

  const windowPromise = app.waitForEvent('window');
  await row.click({ button: 'right' });
  await page.getByTestId(`sidebar-session-open-detached-${sessionId}`).click();
  const detached = await windowPromise;
  await detached.waitForLoadState('domcontentloaded');
  return detached;
}

/** 侧栏会话行 title 属性即会话文件路径（SessionList 里 title={session.path}） */
async function sessionPathOf(page: Page, sessionText: string): Promise<string> {
  const row = page.locator('.sidebar-session-row').filter({ hasText: sessionText });
  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  const sessionPath = await sessionButton.getAttribute('title');
  expect(sessionPath).toBeTruthy();
  return sessionPath!;
}

/** 经 hostInvoke 读 windows.list（窗口↔会话绑定清单） */
async function listHostWindows(page: Page): Promise<Array<{
  windowId: number;
  sessionPath: string | null;
  isMain: boolean;
  focused: boolean;
}>> {
  return page.evaluate(async () => {
    const bridge = (globalThis as unknown as {
      pidesktop: {
        hostInvoke: (request: unknown) => Promise<{ ok: boolean; data?: unknown }>;
      };
    }).pidesktop;
    const response = await bridge.hostInvoke({
      id: 'e2e-windows-list',
      module: 'windows',
      action: 'list',
    });
    if (!response.ok) throw new Error('windows.list failed');
    return response.data as Array<{
      windowId: number;
      sessionPath: string | null;
      isMain: boolean;
      focused: boolean;
    }>;
  });
}

test('右键会话 → 独立窗口加载同会话历史；重复打开聚焦复用不新增窗口', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 会话 ALPHA（稍后 detach）+ 会话 BETA（主窗口当前会话）
  await sendAndWaitReply(page, 'Say PONG multiwin ALPHA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'Say PONG main BETA');
  const alphaPath = await sessionPathOf(page, 'multiwin ALPHA');

  const detached = await openDetachedWindow(app, page, 'multiwin ALPHA');
  await expect.poll(() => app.windows().length).toBe(2);
  await waitSessionReady(detached);

  // 独立窗口按 ?session= attach 同一会话：历史消息完整，且消息列表不含主窗口当前会话内容
  // （注意不能对 body 全文否定断言：detached 窗口保留侧栏，会列出 BETA 会话标题）
  await expect(detached.getByTestId('message-user')).toHaveCount(1, { timeout: 30_000 });
  await expect(detached.getByTestId('message-user').last()).toContainText('multiwin ALPHA');
  await expect(detached.getByTestId('message-assistant').last()).toContainText('PONG');
  await expect(detached.getByTestId('message-user').filter({ hasText: 'BETA' })).toHaveCount(0);
  // 主窗口仍停留在 BETA 会话
  await expect(page.getByTestId('message-user').last()).toContainText('main BETA');

  // windows.list：两个窗口都绑定各自会话，detached 绑定 ALPHA 会话文件
  const listed = await listHostWindows(page);
  expect(listed).toHaveLength(2);
  const detachedEntry = listed.find((entry) => !entry.isMain);
  expect(detachedEntry?.sessionPath).toBe(alphaPath);

  // 同一会话重复 openDetached：聚焦已有窗口，窗口数不增
  const alphaRow = page.locator('.sidebar-session-row').filter({ hasText: 'multiwin ALPHA' });
  const sessionTestId = await alphaRow.locator('[data-testid^="sidebar-session-"]').first().getAttribute('data-testid');
  const sessionId = sessionTestId!.replace('sidebar-session-', '');
  await alphaRow.click({ button: 'right' });
  await page.getByTestId(`sidebar-session-open-detached-${sessionId}`).click();
  // 给潜在的新窗口一个出现窗口期，再断言数量不变
  await page.waitForTimeout(1_000);
  expect(app.windows()).toHaveLength(2);
  expect(await listHostWindows(page)).toHaveLength(2);
});

test('两窗口并发流式：各自收到自己的回复，事件互不串台', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG stream ALPHA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'Say PONG stream BETA');

  const detached = await openDetachedWindow(app, page, 'stream ALPHA');
  await expect.poll(() => app.windows().length).toBe(2);
  await waitSessionReady(detached);

  // SLOW_ECHO 慢速回显：两路 SSE 同时在途，回复各自带 prompt 标记
  await detached.getByTestId('chat-input').fill('SLOW_ECHO detached ALPHA MARKER');
  await detached.getByTestId('chat-send').click();
  await page.getByTestId('chat-input').fill('SLOW_ECHO main BETA MARKER');
  await page.getByTestId('chat-send').click();

  // 各自收到自己的流式回复
  await expect(
    detached.getByTestId('message-assistant').filter({ hasText: 'ALPHA MARKER' }),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(
    page.getByTestId('message-assistant').filter({ hasText: 'BETA MARKER' }),
  ).toHaveCount(1, { timeout: 30_000 });

  // 互不串台：对端会话的 user/assistant 事件都不出现在本窗口
  await expect(detached.locator('body')).not.toContainText('BETA MARKER');
  await expect(page.locator('body')).not.toContainText('ALPHA MARKER');
  await expect(detached.getByTestId('message-user')).toHaveCount(2);
  await expect(page.getByTestId('message-user')).toHaveCount(2);

  // 两轮都结束后，双方 composer 恢复可发状态
  await expect(detached.getByTestId('chat-send')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 30_000 });
});

test('关闭独立窗口 → runtime 保活，主窗口切回该会话历史完好、可继续对话', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG reopen ALPHA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'Say PONG stay BETA');

  const detached = await openDetachedWindow(app, page, 'reopen ALPHA');
  await expect.poll(() => app.windows().length).toBe(2);
  await waitSessionReady(detached);
  await expect(detached.getByTestId('message-user').last()).toContainText('reopen ALPHA', {
    timeout: 30_000,
  });

  await detached.close();
  await expect.poll(() => app.windows().length).toBe(1);
  expect(await listHostWindows(page)).toHaveLength(1);

  // 主窗口切回该会话：历史完好，可继续发消息（runtime 保活）
  const alphaRow = page.locator('.sidebar-session-row').filter({ hasText: 'reopen ALPHA' });
  await alphaRow.locator('[data-testid^="sidebar-session-"]').first().click();
  await expect(page.getByTestId('message-user')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('message-user').last()).toContainText('reopen ALPHA');
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG');

  await sendAndWaitReply(page, 'Say PONG reopen FOLLOWUP');
  await expect(page.getByTestId('message-user')).toHaveCount(2);
});
