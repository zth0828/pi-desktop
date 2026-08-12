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
  // Keep the explicit /compact scenario deterministic across pi versions:
  // the production default remains 20,000, but this fixture must always have
  // history eligible for compaction without relying on tokenizer details.
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 100 } }),
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

test('会话标题、消息复制与 composer 加号菜单', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  await page.locator('.chat-input-card').click({ position: { x: 280, y: 18 } });
  await page.getByTestId('message-assistant').last().hover();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('copy-message').last().click();
  await expect.poll(() => page.evaluate(() => (navigator as Navigator & { clipboard: { readText: () => Promise<string> } }).clipboard.readText())).toContain('PONG');
  await expect(page.getByTestId('copy-markdown')).toHaveCount(0);
  await page.getByTestId('composer-menu').click();
  await expect(page.getByTestId('composer-file-reference')).toBeVisible();
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('composer-file-reference')).toBeHidden();
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('token-usage-popover')).toBeVisible();
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('token-usage-popover')).toBeHidden();
});

test('侧边栏折叠为稳定图标栏并可恢复历史列表', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const sidebar = page.locator('.sidebar');
  const windowControls = page.getByTestId('app-window-controls');
  await expect(windowControls).toBeVisible();
  await expect(windowControls).not.toContainText('Pi');
  await expect(page.getByTestId('session-search-trigger')).toBeVisible();
  const controlsBox = await windowControls.boundingBox();
  const expandedSidebarBox = await sidebar.boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(expandedSidebarBox).not.toBeNull();
  expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(expandedSidebarBox!.x + expandedSidebarBox!.width - 8);
  expect(controlsBox!.x).toBeGreaterThan(expandedSidebarBox!.x + expandedSidebarBox!.width / 2);
  expect(controlsBox!.y).toBeLessThan(12);
  await expect(page.locator('.content')).toHaveCSS('border-top-left-radius', '0px');

  const composerBox = await page.locator('.chat-input-card').boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.width).toBeGreaterThan(820);
  expect(composerBox!.height).toBeGreaterThanOrEqual(110);
  await page.screenshot({ path: 'output/playwright/chat-chrome-refined.png', fullPage: false });

  const expandedWidth = (await sidebar.boundingBox())!.width;
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('sidebar-sessions')).toHaveCount(0);
  await expect(page.getByTestId('nav-chat')).toBeVisible();
  await expect(windowControls).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(80);
  const collapsedControlsBox = await windowControls.boundingBox();
  const collapsedSidebarBox = await sidebar.boundingBox();
  const collapsedNewChatBox = await page.getByTestId('new-chat').boundingBox();
  const collapsedNavBox = await page.getByTestId('nav-chat').boundingBox();
  expect(collapsedControlsBox).not.toBeNull();
  expect(collapsedSidebarBox).not.toBeNull();
  expect(collapsedNewChatBox).not.toBeNull();
  expect(collapsedNavBox).not.toBeNull();
  expect(collapsedSidebarBox!.width).toBe(80);
  expect(collapsedControlsBox!.x).toBeGreaterThanOrEqual(collapsedSidebarBox!.x);
  expect(collapsedControlsBox!.x + collapsedControlsBox!.width).toBeLessThanOrEqual(collapsedSidebarBox!.x + collapsedSidebarBox!.width);
  expect(collapsedControlsBox!.y).toBeGreaterThan(48);
  const sidebarCenter = collapsedSidebarBox!.x + collapsedSidebarBox!.width / 2;
  for (const box of [collapsedControlsBox!, collapsedNewChatBox!, collapsedNavBox!]) {
    expect(Math.abs(box.x + box.width / 2 - sidebarCenter)).toBeLessThanOrEqual(0.5);
  }
  await page.screenshot({ path: 'output/playwright/sidebar-collapsed-refined.png', fullPage: false });
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(expandedWidth - 100);

  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('sidebar-sessions')).toBeVisible();
});

test('工具调用 → 完成后收入回合过程，展开可查看工具结果', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_LS now');
  await page.getByTestId('chat-send').click();

  const summary = page.getByTestId('turn-fold-toggle').last();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await summary.click();
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await page.getByTestId('process-stage-toggle').last().click();
  const card = page.getByTestId('tool-card').last();
  // 动词化一行文案（Codex 范式）：完成态 "Ran $ ls in X.Xs"
  await expect(card.getByTestId('tool-line')).toContainText('Ran $ ls in', { timeout: 30_000 });
  await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });

  // 阶段展开会同步展开工具结果；工具卡仍可单独收起再展开。
  await expect(card.locator('.tool-card-body pre').last()).toBeVisible();
  await card.locator('.tool-card-header').click();
  await expect(card.locator('.tool-card-body')).toHaveCount(0);
  await card.locator('.tool-card-header').click();
  await expect(card.locator('.tool-card-body pre').last()).toBeVisible();

  // 再点回合过程可折回。
  await summary.click();
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await expect(page.getByTestId('turn-fold-toggle')).toHaveCount(1);
});

test('edit 工具 → 行级 diff 展示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_EDIT now');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('turn-fold-toggle').last()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('turn-fold-toggle').last().click();
  await page.getByTestId('process-stage-toggle').last().click();
  const card = page.getByTestId('tool-card').last();
  await expect(card.getByTestId('tool-line')).toContainText('Edited e2e-edit-target.txt', { timeout: 30_000 });
  await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });

  // 折叠态即渲染 diff：删除红 / 新增绿
  const diff = card.getByTestId('diff-view');
  await expect(diff).toBeVisible();
  await expect(diff.locator('.diff-del')).toContainText('alpha');
  await expect(diff.locator('.diff-add')).toContainText('beta');
});

test('阶段内工具卡可单独展开和折叠', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_LS now');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('turn-fold-toggle').last()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('turn-fold-toggle').last().click();
  await page.getByTestId('process-stage-toggle').last().click();
  const card = page.getByTestId('tool-card').last();
  await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });
  await expect(card.locator('.tool-card-body')).toBeVisible();

  // 阶段打开后，工具卡仍可单独收起再打开。
  await card.locator('.tool-card-header').click();
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

test('工作中状态在聊天列内居中', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();
  const indicator = page.getByTestId('status-working');
  await expect(indicator).toBeVisible({ timeout: 30_000 });
  const chatBox = await page.locator('.chat-column').boundingBox();
  const indicatorBox = await indicator.boundingBox();
  expect(chatBox).not.toBeNull();
  expect(indicatorBox).not.toBeNull();
  expect(Math.abs((indicatorBox!.x + indicatorBox!.width / 2) - (chatBox!.x + chatBox!.width / 2))).toBeLessThan(6);
  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('status-bar')).toHaveCount(0, { timeout: 30_000 });
});

test('首问自动命名，本轮统计与 pi usage 口径一致', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
  await expect(page.getByTestId('session-title-button')).toContainText('Say PONG', { timeout: 5_000 });
  await expect(page.getByTestId('turn-stats')).toContainText(/Turn total|本轮合计/);
  await expect(page.getByTestId('turn-stats')).toContainText(/s|秒/);

  // 收尾卡直接使用 pi latestTurn：总数与当前上下文对齐，input 与首轮会话累计对齐。
  const statsTokens = page.getByTestId('turn-stats-tokens');
  const turnTotal = Number(await statsTokens.getAttribute('data-total'));
  const turnInput = Number(await statsTokens.getAttribute('data-input'));
  await page.getByTestId('token-usage').click();
  const parseTokens = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));
  await expect.poll(async () => parseTokens(
    await page.getByTestId('usage-context-used').locator('strong').textContent(),
  )).toBe(turnTotal);
  await expect.poll(async () => parseTokens(
    await page.getByTestId('usage-session-input').locator('strong').textContent(),
  )).toBe(turnInput);
});

test('富文本答复渲染任务卡、表格、代码块和外链', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.getByTestId('chat-input').fill('RICH_MARKDOWN');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('Release plan', { timeout: 30_000 });
  await expect(page.getByTestId('task-card')).toBeVisible();
  await expect(page.getByTestId('task-progress')).toContainText('1/3');
  await expect(page.locator('.markdown table')).toBeVisible();
  await expect(page.locator('[data-streamdown="code-block"]')).toBeVisible();
  const renderedCode = page.locator('[data-streamdown="code-block-body"] code');
  await expect(renderedCode).toContainText('console.log(answer)');
  expect(await renderedCode.evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).whiteSpace)).toBe('pre');
  expect(await renderedCode.innerText()).toContain('const answer = 42;\nif (answer)');
  await expect(page.locator('.markdown blockquote')).toBeVisible();
  await expect(page.locator('.markdown a[href="https://example.com/docs"]')).toBeVisible();
  await page.screenshot({ path: 'output/playwright/rich-text-light.png', fullPage: false });
  await page.evaluate(() => {
    const root = (globalThis as unknown as {
      document: { documentElement: { setAttribute(name: string, value: string): void } };
    }).document.documentElement;
    root.setAttribute('data-theme', 'dark');
  });
  await page.screenshot({ path: 'output/playwright/rich-text-dark.png', fullPage: false });
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
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByTestId('workspace-toggle').click();
  await expect(page.getByTestId('review-panel')).toBeVisible();

  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();
  // 流式中：发送按钮变为 Queue（入队 followUp）+ Stop 组合
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chat-queue-send')).toBeVisible();
  await expect(page.getByTestId('chat-queue-send').locator('span')).toHaveText(/Queue|Steer|排队|插队/);
  await expect(page.getByTestId('chat-queue-send').locator('span')).toHaveCSS('white-space', 'nowrap');
  const stopBox = await page.getByTestId('chat-stop').boundingBox();
  expect(stopBox?.width).toBe(30);
  expect(stopBox?.height).toBe(30);
  const panelBox = await page.getByTestId('review-panel').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(Math.abs(panelBox!.x + panelBox!.width - 1200)).toBeLessThan(2);
  expect(await page.locator('.chat-input-card').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'output/playwright/narrow-composer-workspace.png', fullPage: false });

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

test('长文本输入自然增长，达到上限后使用短暂滚动条', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.setViewportSize({ width: 1200, height: 800 });

  const input = page.getByTestId('chat-input');
  const initialHeight = (await input.boundingBox())!.height;
  await input.fill(Array.from({ length: 40 }, (_, index) => `line ${index + 1} with enough text to edit comfortably`).join('\n'));
  await expect(input).toHaveClass(/is-scrollable/);
  const expandedHeight = (await input.boundingBox())!.height;
  expect(expandedHeight).toBeGreaterThan(initialHeight + 80);
  expect(expandedHeight).toBeLessThanOrEqual(260);

  await input.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(input).toHaveClass(/scrollbar-active/);
  await page.screenshot({ path: 'output/playwright/long-composer.png', fullPage: false });
  await expect.poll(async () => (await input.getAttribute('class'))?.includes('scrollbar-active')).toBe(false);

  await input.fill('short prompt');
  await expect(input).not.toHaveClass(/is-scrollable/);
  const collapsedHeight = (await input.boundingBox())!.height;
  expect(collapsedHeight).toBeLessThan(expandedHeight - 80);
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
  // Keep each turn above keepRecentTokens in aggregate without crossing the
  // model context threshold before the explicit /compact command.
  const big = 'word '.repeat(15_000);
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

  // Depending on the installed pi version, the fixture summary may complete before
  // the next renderer frame. Observe the live state when it is present, while the
  // persisted compaction summary below remains the completion contract.
  const compacting = page.getByTestId('status-compaction');
  if (await compacting.count()) await expect(compacting).toBeVisible();
  // compaction 后 pi 重建上下文，壳从 runtime 重读：摘要消息出现、被压掉的 user 消息消失
  await expect(page.getByTestId('message-compaction')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByTestId('status-compaction')).toHaveCount(0, { timeout: 30_000 });
});
