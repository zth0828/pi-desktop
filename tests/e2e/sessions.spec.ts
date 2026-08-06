// M4 验收：会话管理（列表/切换/重命名/删除，真 pi + mock provider，不烧 API quota）。
// 每个测试独立 agentDir（会话文件互相隔离），模式同 models.spec.ts。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    JSON.stringify({ defaultModel: 'mock/mock-1' }),
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
async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 发一条消息并等 mock 回复落地（保证会话文件已写入） */
async function sendAndWaitReply(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

const sessionRows = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid^="session-row-"]');

test('发消息 → Sessions 页出现该会话（firstMessage 匹配，标记为当前）', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG alpha');

  await page.getByTestId('nav-sessions').click();
  const row = sessionRows(page).filter({ hasText: 'Say PONG alpha' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row.getByTestId('session-current')).toBeVisible();
});

test('切换会话 → 消息列表恢复目标会话内容', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'session one ALPHA');
  await page.getByTestId('new-session').click();
  await sendAndWaitReply(page, 'session two BRAVO');

  await page.getByTestId('nav-sessions').click();
  await expect(sessionRows(page)).toHaveCount(2, { timeout: 15_000 });

  // 点 ALPHA 那行切回去（行主体即切换按钮）
  const alphaRow = sessionRows(page).filter({ hasText: 'session one ALPHA' });
  await alphaRow.locator('.session-row-main').click();
  // 切换后它成为当前会话
  await expect(alphaRow.getByTestId('session-current')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('message-user').last()).toContainText('session one ALPHA');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

test('重命名 → 列表显示新名', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'rename me please');

  await page.getByTestId('nav-sessions').click();
  const row = sessionRows(page).filter({ hasText: 'rename me please' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });

  await row.getByTestId('session-rename').click();
  await row.getByTestId('session-rename-input').fill('My Renamed Session');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(
    sessionRows(page).filter({ hasText: 'My Renamed Session' }),
  ).toHaveCount(1, { timeout: 15_000 });
});

test('删除（二次确认）→ 列表减少', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'delete me DELTA');
  await page.getByTestId('new-session').click();
  await sendAndWaitReply(page, 'keep me ECHO');

  await page.getByTestId('nav-sessions').click();
  await expect(sessionRows(page)).toHaveCount(2, { timeout: 15_000 });

  const deltaRow = sessionRows(page).filter({ hasText: 'delete me DELTA' });
  await deltaRow.getByTestId('session-delete').click();
  // 未确认前不删
  await expect(sessionRows(page)).toHaveCount(2);
  await deltaRow.getByTestId('session-delete-confirm').click();

  await expect(sessionRows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(sessionRows(page).filter({ hasText: 'keep me ECHO' })).toHaveCount(1);
});
