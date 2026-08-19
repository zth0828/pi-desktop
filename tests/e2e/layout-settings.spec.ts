// 布局改版 / Settings / 图片输入 的 E2E。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

/** 测试结束后 app 进程可能尚未释放 agentDir 里的文件，rm 需要重试避免 ENOTEMPTY/EBUSY 污染结果。 */
async function rmAgentDir(agentDir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(agentDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  if (lastError) throw lastError;
}

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
  // 拖拽层只存在于 macOS 无框标题栏；Windows 用原生标题栏
  if (process.platform === 'darwin') {
    const dragStrip = page.getByTestId('window-drag-strip');
    await expect(dragStrip).toBeVisible();
    await expect(dragStrip).toHaveCSS('-webkit-app-region', 'drag');
    await expect(page.getByTestId('new-chat')).toBeVisible();
    const dragBox = await dragStrip.boundingBox();
    const newChatBox = await page.getByTestId('new-chat').boundingBox();
    expect(dragBox).not.toBeNull();
    expect(newChatBox).not.toBeNull();
    expect(newChatBox!.y).toBeGreaterThanOrEqual(dragBox!.height + 8);
  } else {
    await expect(page.getByTestId('new-chat')).toBeVisible();
  }
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
  await expect(page.locator('.settings-page')).toContainText(/pi\s*v0\.84/);
  await expect(page.getByTestId('settings-pi-status')).toContainText(/pi v0\.84/);
  await expect(page.locator('.sidebar-footer')).toHaveCount(0);
  await expect(page.getByTestId('settings-session-exports')).toBeVisible();
  await rmAgentDir(agentDir);
});

test('Settings：默认思考深度与自动重试写回 pi settings.json', async ({ launchElectronApp }) => {
  const agentDir = await makeAgentDir();
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();

  await page.getByTestId('nav-settings').click();
  const section = page.getByTestId('settings-agent-defaults');
  await expect(section).toBeVisible();

  await page.getByTestId('default-thinking-high').click();
  await page.getByTestId('retry-enabled-off').click();
  await page.getByTestId('retry-max-retries').fill('5');
  await page.getByTestId('retry-max-retries').blur();

  await expect(async () => {
    const settings = JSON.parse(
      await readFile(path.join(agentDir, 'settings.json'), 'utf8'),
    ) as { defaultThinkingLevel?: string; retry?: { enabled?: boolean; maxRetries?: number } };
    expect(settings.defaultThinkingLevel).toBe('high');
    expect(settings.retry?.enabled).toBe(false);
    expect(settings.retry?.maxRetries).toBe(5);
  }).toPass({ timeout: 10_000 });
  await rmAgentDir(agentDir);
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
  await expect(page.getByTestId('staged-attachments').locator('img')).toHaveCount(1);
  await page.getByTestId('staged-image-preview').click();
  await expect(page.getByTestId('image-lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-lightbox')).toHaveCount(0);

  await page.getByTestId('chat-input').fill('what is this image');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('message-user').last().getByTestId('message-image')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId('message-image').last().click();
  await expect(page.getByTestId('image-lightbox')).toBeVisible();
  await page.getByTestId('image-lightbox-close').click();
  await expect(page.getByTestId('image-lightbox')).toHaveCount(0);
  await page.getByTestId('message-image').last().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-lightbox')).toHaveCount(0);
  await page.getByTestId('message-image').last().click();
  await page.getByTestId('image-lightbox').click({ position: { x: 6, y: 6 } });
  await expect(page.getByTestId('image-lightbox')).toHaveCount(0);
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await rmAgentDir(agentDir);
});

test('混合附件：按上传顺序独立渲染，并向模型声明图片序号', async ({ launchElectronApp }) => {
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

  await page.getByTestId('attach-input').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: TINY_PNG },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('ORDERED_FILE_CONTENT') },
    { name: 'second.png', mimeType: 'image/png', buffer: TINY_PNG },
  ]);
  const staged = page.getByTestId('staged-attachments').locator('[data-attachment-index]');
  await expect(staged).toHaveCount(3);
  await expect(staged.nth(0)).toHaveAttribute('data-attachment-index', '1');
  await expect(staged.nth(1)).toContainText('notes.txt');
  await expect(staged.nth(2)).toHaveAttribute('data-attachment-index', '3');

  const longText = `ATTACHMENT_ORDER_CHECK ${'Long text stays in its own surface. '.repeat(24)}`;
  await page.getByTestId('chat-input').fill(longText);
  await page.getByTestId('chat-send').click();

  const message = page.getByTestId('message-user').last();
  const sent = message.getByTestId('message-attachment');
  await expect(sent).toHaveCount(3, { timeout: 15_000 });
  await expect(sent.nth(0)).toContainText('first.png');
  await expect(sent.nth(0)).toHaveAttribute('data-attachment-index', '1');
  await expect(sent.nth(1)).toContainText('notes.txt');
  await expect(sent.nth(1)).toHaveAttribute('data-attachment-index', '2');
  await expect(sent.nth(2)).toContainText('second.png');
  await expect(sent.nth(2)).toHaveAttribute('data-attachment-index', '3');
  await expect(message.getByTestId('message-user-text')).toContainText('Long text stays in its own surface.');
  await expect(message.getByTestId('message-user-text')).not.toContainText('<file');
  await expect(page.getByTestId('message-assistant').last()).toContainText('ATTACHMENT_ORDER_OK images=2', { timeout: 30_000 });
  await expect(page.locator('.session-title')).not.toContainText('<attachments>');

  await page.setViewportSize({ width: 1180, height: 820 });
  await page.screenshot({ path: 'output/playwright/ordered-attachments-desktop.png', fullPage: false });
  await page.setViewportSize({ width: 760, height: 820 });
  const messageBox = await message.boundingBox();
  const viewport = page.viewportSize();
  expect(messageBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(messageBox!.x + messageBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  await page.screenshot({ path: 'output/playwright/ordered-attachments-narrow.png', fullPage: false });
  await rmAgentDir(agentDir);
});
