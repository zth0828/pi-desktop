// 斜杠命令覆盖对齐 CLI 的 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖：/name 改名（侧栏联动）、/copy 剪贴板、扩展 registerCommand 进补全、
// /settings 导航、/session 信息弹层。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let agentDir: string;
let workspace: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  const mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock server timeout')), 10_000);
  });

  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
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
  await mkdir(path.join(workspace, '.pi/prompts'), { recursive: true });
  for (let index = 1; index <= 8; index += 1) {
    await writeFile(
      path.join(workspace, `.pi/prompts/overflow-${index}.md`),
      `---\ndescription: Overflow command ${index}\n---\nOverflow command ${index}.`,
    );
  }
  // 扩展 registerCommand 进补全的验证扩展（<agentDir>/extensions 自动发现）
  await mkdir(path.join(agentDir, 'extensions'), { recursive: true });
  await writeFile(
    path.join(agentDir, 'extensions', 'e2e-command.ts'),
    [
      'export default function (pi: { registerCommand: (name: string, options: object) => void }) {',
      '  pi.registerCommand("hello-ext", {',
      '    description: "E2E extension command",',
      '    handler: async () => {},',
      '  });',
      '}',
      '',
    ].join('\n'),
  );
});

test.afterAll(async () => {
  mock?.kill();
  await rm(agentDir, { recursive: true, force: true });
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

/** 发一轮消息并等回复（让会话落盘、产生 assistant 消息） */
async function sendOneRound(page: import('@playwright/test').Page) {
  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

test('/name 改名 → 确认提示 + 侧栏会话标题联动', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await sendOneRound(page);

  await page.getByTestId('chat-input').fill('/name E2E Renamed Session');
  await page.getByTestId('chat-input').press('Enter');

  // 轻量确认（两种语言都包含名字本身）
  await expect(page.getByTestId('chat-notice')).toContainText('E2E Renamed Session', {
    timeout: 15_000,
  });
  // 侧栏当前会话标题变为新名字（main 推 sessionReplaced 触发列表刷新）
  await expect(page.locator('.sidebar-session.current .sidebar-session-title')).toHaveText(
    'E2E Renamed Session',
    { timeout: 15_000 },
  );
});

test('/copy → 最后一条 assistant 回复进剪贴板', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await sendOneRound(page);

  await page.getByTestId('chat-input').fill('/copy');
  // 面板打开时 Enter = 选中补全项直接执行（无参命令）
  await page.getByTestId('chat-input').press('Enter');

  await expect(page.getByTestId('chat-notice')).toBeVisible({ timeout: 15_000 });
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clipboard).toContain('PONG');
});

test('扩展 registerCommand 的命令出现在 / 补全列表', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('/hello');
  const item = page.getByTestId('command-hello-ext');
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(item.locator('.command-source')).toHaveText(/^extension/);
  await expect(item.locator('.command-desc')).toHaveText('E2E extension command');
});

test('/ 命令补全：键盘切换时高亮命令始终滚入可视区域', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const input = page.getByTestId('chat-input');
  await input.fill('/');
  const panel = page.getByTestId('command-panel');
  await expect(panel).toBeVisible();
  const count = await panel.locator('.command-item').count();
  expect(count).toBeGreaterThan(16);

  for (let index = 1; index < count; index += 1) await input.press('ArrowDown');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const bottomSelection = await panel.evaluate((element) => {
    const selected = element.querySelector('.command-item.selected');
    if (!selected) return null;
    const panelRect = element.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return {
      top: selectedRect.top - panelRect.top,
      bottom: panelRect.bottom - selectedRect.bottom,
    };
  });
  expect(bottomSelection?.top).toBeGreaterThanOrEqual(0);
  expect(bottomSelection?.bottom).toBeGreaterThanOrEqual(0);

  for (let index = 1; index < count; index += 1) await input.press('ArrowUp');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
});

test('/settings → 导航到设置页', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('/settings');
  await page.getByTestId('chat-input').press('Enter');

  await expect(page.getByTestId('nav-settings')).toHaveClass(/active/, { timeout: 15_000 });
});

test('/session → 会话信息弹层', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await sendOneRound(page);

  await page.getByTestId('chat-input').fill('/session');
  await page.getByTestId('chat-input').press('Enter');

  const dialog = page.getByTestId('session-info-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // 消息统计行可见（会话已有一轮对话）
  await expect(dialog.locator('.usage-row').nth(2)).toBeVisible();
  await dialog.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
});
