// 排队消息交互 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖：流式中显式 followUp/steer、取回编辑、稍后消息改为当前轮引导。
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

/** SLOW 流式窗口（30 chunk × 100ms）内入队一条 followUp 消息 */
async function startSlowAndQueue(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
  // 空闲时队列列表不渲染
  await expect(page.getByTestId('queue-list')).toHaveCount(0);

  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-queue-send').click();
  const item = page.getByTestId('queue-item-followUp');
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect(item).toContainText(text);
  return item;
}

test('稍后消息可取回输入框编辑后重新发送', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const item = await startSlowAndQueue(page, 'queued first message');

  await page.getByTestId('queue-remove-followUp-0').click();
  await expect(item).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('queue-list')).toHaveCount(0);
  await expect(page.getByTestId('chat-input')).toHaveValue('queued first message');

  await page.getByTestId('chat-input').fill('edited queued message');
  await page.getByTestId('chat-steer-send').click();
  const steering = page.getByTestId('queue-item-steering');
  await expect(steering).toContainText('edited queued message', { timeout: 30_000 });

  await page.getByTestId('chat-stop').click();
});

test('停止当前运行会清空队列并将内容恢复到编辑器', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await startSlowAndQueue(page, 'follow up after stop');
  await page.getByTestId('chat-input').fill('guide before stop');
  await page.getByTestId('chat-steer-send').click();
  await expect(page.getByTestId('queue-item-steering')).toContainText('guide before stop');

  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('queue-list')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('chat-input')).toHaveValue('guide before stop\n\nfollow up after stop');
});

test('队列项「立即发送」→ 移出 followUp 并 steer 插入当前轮', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const item = await startSlowAndQueue(page, 'steer this now');

  // 立即发送：从 followUp 队列移出，转为 steering（当前轮工具间隙插入）
  await page.getByTestId('queue-steer-now-0').click();
  await expect(item).toHaveCount(0, { timeout: 30_000 });
  const steering = page.getByTestId('queue-item-steering');
  await expect(steering).toBeVisible({ timeout: 30_000 });
  await expect(steering).toContainText('steer this now');

  await page.getByTestId('chat-stop').click();
});
