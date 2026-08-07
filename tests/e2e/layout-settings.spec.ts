// 布局改版 / Settings / 图片输入 的 E2E。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

// 1x1 透明 PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let mock: ChildProcess;
let mockPort: number;
let workspace: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock timeout')), 10_000);
  });
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
});

async function makeAgentDir(): Promise<string> {
  const agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
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
              input: ['text', 'image'],
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
  return agentDir;
}

test('侧栏：新会话按钮 + 发消息后会话列表出现', async ({ launchElectronApp }) => {
  const agentDir = await makeAgentDir();
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  const dragStrip = page.getByTestId('window-drag-strip');
  await expect(dragStrip).toBeVisible();
  await expect(dragStrip).toHaveCSS('-webkit-app-region', 'drag');
  await expect(page.getByTestId('new-chat')).toBeVisible();
  const dragBox = await dragStrip.boundingBox();
  const newChatBox = await page.getByTestId('new-chat').boundingBox();
  expect(dragBox).not.toBeNull();
  expect(newChatBox).not.toBeNull();
  expect(newChatBox!.y).toBeGreaterThanOrEqual(dragBox!.height + 8);
  await expect(page.locator('.chat-header')).toHaveCount(0);
  await expect(page.getByTestId('chat-workspace')).toBeVisible();
  await expect(page.getByTestId('model-select').or(page.getByTestId('model-badge')).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('token-usage-popover')).toBeVisible();
  await expect(page.getByTestId('token-usage-popover')).toContainText(/Context|上下文/);

  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  await expect(page.getByTestId('sidebar-sessions')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sidebar-sessions')).toContainText('Say PONG');
});

test('Settings：语言切换为中文即时生效并持久化', async ({ launchElectronApp }) => {
  const agentDir = await makeAgentDir();
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-language')).toBeVisible();
  await page.getByTestId('lang-zh').click();
  await expect(page.getByTestId('nav-chat')).toHaveText('对话');
  // 版本区显示 pi 版本
  await expect(page.locator('.settings-page')).toContainText(/pi\s*v0\.83/);
  await rm(agentDir, { recursive: true, force: true });
});

test('图片输入：附件入列 → 随消息发送 → 用户消息渲染图片', async ({ launchElectronApp }) => {
  const agentDir = await makeAgentDir();
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('attach-input').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(page.getByTestId('staged-images').locator('img')).toHaveCount(1);

  await page.getByTestId('chat-input').fill('what is this image');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('message-user').last().getByTestId('message-image')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await rm(agentDir, { recursive: true, force: true });
});
