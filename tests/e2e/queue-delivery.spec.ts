// 排队消息在 run 结束后的投递 E2E（真 pi + mock provider）。
// 覆盖：
//   - 流式中排队的 steer 消息在 run 结束后自动投递（第二轮回复 + 队列清空）
//   - 流式中排队的 followUp 消息在 run 结束后自动投递
//   - 队列项「改为本轮引导」（立即发送）→ 移出 followUp 并 steer 插入当前轮
// mock 的 SLOW_END 分支 = 30 chunk × 100ms 且自然结束（区别于 SLOW 的挂起流，供 abort 测试）。
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

  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-delivery-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-delivery-workspace-'));
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

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 启动 SLOW_END 流式窗口并等聊天运行起来（chat-stop 出现）。 */
async function startSlowEnd(page: import('@playwright/test').Page) {
  await page.getByTestId('chat-input').fill('SLOW_END stream please');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
}

/** 等运行全部结束（chat-stop 消失 = isStreaming 且无其他运行态）。 */
async function waitRunEnded(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('chat-stop')).not.toBeVisible({ timeout: 30_000 });
}

test('流式中排队的 steer 消息在 run 结束后自动投递', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await startSlowEnd(page);

  // 流式中排队一条 steer 消息（发送按钮 = 引导当前轮）
  await page.getByTestId('chat-input').fill('queued during stream');
  await page.getByTestId('chat-queue-send').click();
  const steering = page.getByTestId('queue-item-steering');
  await expect(steering).toBeVisible({ timeout: 30_000 });
  await expect(steering).toContainText('queued during stream');

  // SLOW_END ≈ 3s 后第一轮结束：steer 消息应在下一轮投递（队列清空 + 第二轮 PONG 回复）
  await waitRunEnded(page);
  await expect(page.getByTestId('queue-list')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
});

test('流式中排队的 followUp 消息在 run 结束后自动投递', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await startSlowEnd(page);

  // Enter = 排队 followUp（稍后继续）
  await page.getByTestId('chat-input').fill('followup queued');
  await page.keyboard.press('Enter');
  const followUp = page.getByTestId('queue-item-followUp');
  await expect(followUp).toBeVisible({ timeout: 30_000 });
  await expect(followUp).toContainText('followup queued');

  // run 结束后 followUp 自动投递（pi agent loop 的外层兜底），队列清空 + 第二轮回复
  await waitRunEnded(page);
  await expect(page.getByTestId('queue-list')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
});

test('队列项「改为本轮引导」→ 移出 followUp 并 steer 插入当前轮，run 结束后投递', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await startSlowEnd(page);

  // Enter 排队 followUp，再点「改为本轮引导」（立即发送语义）
  await page.getByTestId('chat-input').fill('steer this now');
  await page.keyboard.press('Enter');
  const followUp = page.getByTestId('queue-item-followUp');
  await expect(followUp).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('queue-mode-followUp-0').click();
  const steering = page.getByTestId('queue-item-steering');
  await expect(steering).toBeVisible({ timeout: 30_000 });
  await expect(steering).toContainText('steer this now');

  // 当前轮结束后 steer 消息投递
  await waitRunEnded(page);
  await expect(page.getByTestId('queue-list')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
});
