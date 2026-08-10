// M2 验收：聊天主链路 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖 §7.2：事件完整性（流式渲染）、工具卡片、中断语义、新会话。
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
  // edit 工具 E2E 的目标文件（mock 会把 alpha → beta）
  await writeFile(path.join(workspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
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

test('发消息 → 流式渲染回复', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('message-user').last()).toContainText('Say PONG');
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
});

test('会话标题菜单、消息复制与 composer 加号菜单', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  await page.getByTestId('session-menu').click();
  await expect(page.getByTestId('open-review')).toBeVisible();
  await page.locator('.chat-input-card').click({ position: { x: 280, y: 18 } });
  await expect(page.getByTestId('open-review')).toBeHidden();
  await page.getByTestId('message-assistant').last().hover();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('copy-message').last().click();
  await expect.poll(() => page.evaluate(() => (navigator as Navigator & { clipboard: { readText: () => Promise<string> } }).clipboard.readText())).toContain('PONG');
  await page.getByTestId('composer-menu').click();
  await expect(page.getByTestId('composer-file-reference')).toBeVisible();
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('composer-file-reference')).toBeHidden();
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('token-usage-popover')).toBeVisible();
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('token-usage-popover')).toBeHidden();
});

test('工具调用 → 完成后聚合，展开摘要可查看工具结果', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_LS now');
  await page.getByTestId('chat-send').click();

  const summary = page.getByTestId('work-log-row').last();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await summary.click();
  const card = page.getByTestId('tool-card').last();
  // 动词化一行文案（Codex 范式）：完成态 "Ran $ ls in X.Xs"
  await expect(card.getByTestId('tool-line')).toContainText('Ran $ ls in', { timeout: 30_000 });
  await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });

  // 展开看结果
  await card.locator('.tool-card-header').click();
  await expect(card.locator('.tool-card-body pre').last()).toBeVisible();

  // 再点摘要行可折回（展开态保留「收起」锚点）
  await summary.click();
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await expect(page.getByTestId('work-log-row')).toHaveCount(1);
});

test('edit 工具 → 行级 diff 展示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_EDIT now');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('work-log-row').last()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('work-log-row').last().click();
  const card = page.getByTestId('tool-card').last();
  await expect(card.getByTestId('tool-line')).toContainText('Edited e2e-edit-target.txt', { timeout: 30_000 });
  await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });

  // 折叠态即渲染 diff：删除红 / 新增绿
  const diff = card.getByTestId('diff-view');
  await expect(diff).toBeVisible();
  await expect(diff.locator('.diff-del')).toContainText('alpha');
  await expect(diff.locator('.diff-add')).toContainText('beta');
});

test('全局展开/折叠工具卡片', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_LS now');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('work-log-row').last()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('work-log-row').last().click();
  const card = page.getByTestId('tool-card').last();
  await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });
  await expect(card.locator('.tool-card-body')).toHaveCount(0);

  await page.getByTestId('session-menu').click();
  await page.getByTestId('toggle-tools').click();
  await expect(card.locator('.tool-card-body')).toBeVisible();

  // 全局折叠后卡片仍可单独点开
  if (!(await page.getByTestId('toggle-tools').isVisible())) await page.getByTestId('session-menu').click();
  await page.getByTestId('toggle-tools').click();
  await expect(card.locator('.tool-card-body')).toHaveCount(0);
  await card.locator('.tool-card-header').click();
  await expect(card.locator('.tool-card-body')).toBeVisible();
});

test('生成中停止 → 流式中断、按钮复位', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 30_000 });
});

test('生成中 → 状态条 Working，结束后消失', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();

  const working = page.getByTestId('status-working');
  await expect(working).toBeVisible({ timeout: 30_000 });
  await expect(working).toContainText(/Working|工作中/);

  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('status-bar')).toHaveCount(0, { timeout: 30_000 });
});

test('429 → 状态条重试倒计时，重试成功后拿到回复', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('FLAKE_429 please');
  await page.getByTestId('chat-send').click();

  const retry = page.getByTestId('status-retry');
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await expect(retry).toContainText(/Retrying|重试/);

  // mock 第二次请求正常返回，重试成功后状态条消失
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('status-bar')).toHaveCount(0, { timeout: 30_000 });
});

test('生成中再发消息 → Enter 排队（followUp），Alt+Enter steer 当前轮插入', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();
  // 流式中：发送按钮变为 Queue（入队 followUp）+ Stop 组合
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chat-queue-send')).toBeVisible();

  // Enter = 排队（followUp）：queue_update → followUp chip
  await page.getByTestId('chat-input').fill('queue me');
  await page.getByTestId('chat-input').press('Enter');
  const followUpChip = page.getByTestId('queue-chip-followUp');
  await expect(followUpChip).toBeVisible({ timeout: 30_000 });
  await expect(followUpChip).toContainText('queue me');

  // Alt+Enter = steer（当前轮插入）：queue_update → steering chip
  await page.getByTestId('chat-input').fill('steer me');
  await page.getByTestId('chat-input').press('Alt+Enter');
  const steeringChip = page.getByTestId('queue-chip-steering');
  await expect(steeringChip).toBeVisible({ timeout: 30_000 });
  await expect(steeringChip).toContainText('steer me');
});

test('新会话 → 消息列表清空', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });

  await page.getByTestId('new-chat').click();
  await expect(page.getByTestId('message-assistant')).toHaveCount(0);
  // 新会话仍可继续对话
  await page.getByTestId('chat-input').fill('Say PONG again');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
});

test('缓存失效 → assistant 尾部显示 cache miss 警告', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // mock CACHE_MISS 模式：第一轮 usage 全量 cache_write（上报过缓存），第二轮零缓存
  await page.getByTestId('chat-input').fill('CACHE_MISS turn one');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await page.getByTestId('chat-input').fill('CACHE_MISS turn two');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });

  // min(prev=6000, cur=6100) - cacheRead=0 = 6.0k tokens re-billed
  const notice = page.getByTestId('cache-miss-notice');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText('Cache miss');
  await expect(notice).toContainText('6.0k');
});

test('/compact → 压缩状态条，完成后消息列表刷新为摘要', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 两轮大消息：让较旧的历史超过 keepRecentTokens（默认 20000），压缩才有内容可压
  const big = 'x'.repeat(120_000);
  await page.getByTestId('chat-input').fill(big);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await page.getByTestId('chat-input').fill(big);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('message-user')).toHaveCount(2);

  await page.getByTestId('chat-input').fill('/compact');
  await page.getByTestId('chat-send').click();

  // mock 对摘要请求慢速流，状态条有可观测窗口
  await expect(page.getByTestId('status-compaction')).toBeVisible({ timeout: 30_000 });
  // compaction 后 pi 重建上下文，壳从 runtime 重读：摘要消息出现、被压掉的 user 消息消失
  await expect(page.getByTestId('message-compaction')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByTestId('status-compaction')).toHaveCount(0, { timeout: 30_000 });
});
