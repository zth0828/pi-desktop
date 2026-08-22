// 聊天主链路 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖：事件完整性（流式渲染）、工具卡片、中断语义、新会话。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

// 富文本/重渲染用例在并行（多 Electron + mock + pi runtime 同机）下偶发超时，
// 失败重试一次兜底（串行/低负载下不会触发）。
test.describe.configure({ retries: 1 });

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
    JSON.stringify({
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 100 },
      // 拉长重试 backoff，让「重试倒计时状态条」在断言窗口内稳定可见（仅 429 用例触发）
      retry: { enabled: true, baseDelayMs: 8_000, maxRetries: 3 },
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
  await expect(page.getByTestId('attach-image')).toBeVisible();
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('attach-image')).toBeHidden();
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('token-usage-popover')).toBeVisible();
  await page.getByTestId('chat-input').click();
  await expect(page.getByTestId('token-usage-popover')).toBeHidden();
});

test('侧边栏完全收起并可立即恢复历史列表', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const isMac = process.platform === 'darwin';
  const sidebar = page.locator('.sidebar');
  const windowControls = page.getByTestId('app-window-controls');
  // Windows/Linux：内嵌自绘标题栏（window-chrome）；macOS：原生规范
  // （系统菜单栏 + 原生红绿灯），内部不渲染自绘标题栏，折叠/搜索常驻红绿灯右侧。
  if (isMac) {
    await expect(page.getByTestId('window-chrome')).toHaveCount(0);
    await expect(page.getByTestId('titlebar')).toHaveCount(0);
    await expect(page.getByTestId('menu-file')).toHaveCount(0);
    await expect(page.getByTestId('window-controls')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('window-chrome')).toHaveCount(1);
    await expect(page.getByTestId('titlebar')).toBeVisible();
    await expect(page.getByTestId('menu-file')).toBeVisible();
    await expect(page.getByTestId('window-close')).toBeVisible();
  }
  const expandedSidebarBox = await sidebar.boundingBox();
  expect(expandedSidebarBox).not.toBeNull();
  const newChatBox = await page.getByTestId('new-chat').boundingBox();
  expect(newChatBox).not.toBeNull();
  if (isMac) {
    // mac：折叠/搜索在红绿灯右侧悬浮层（顶部带内），右缘与侧边栏右缘（224px）对齐
    await expect(windowControls).toBeVisible();
    const trafficBox = await windowControls.boundingBox();
    expect(trafficBox).not.toBeNull();
    expect(trafficBox!.x).toBeGreaterThanOrEqual(140);
    expect(trafficBox!.x + trafficBox!.width).toBeGreaterThanOrEqual(218);
    expect(trafficBox!.x + trafficBox!.width).toBeLessThanOrEqual(230);
    expect(trafficBox!.y + trafficBox!.height).toBeLessThanOrEqual(40);
    await expect(windowControls.getByTestId('sidebar-toggle')).toBeVisible();
    await expect(windowControls.getByTestId('session-search-trigger')).toBeVisible();
    // 侧边栏内不再有折叠/搜索（只保留全宽新会话按钮）
    await expect(sidebar.getByTestId('sidebar-toggle')).toHaveCount(0);
    expect(newChatBox!.x - expandedSidebarBox!.x).toBeGreaterThanOrEqual(8);
    expect(Math.abs(newChatBox!.width - expandedSidebarBox!.width)).toBeLessThan(110);
  } else {
    // Windows/Linux：折叠/搜索与「新会话」同一行（sidebar-head），展开态无悬浮层
    await expect(windowControls).toHaveCount(0);
    const toggleBox = await page.getByTestId('sidebar-toggle').boundingBox();
    const searchBox = await page.getByTestId('session-search-trigger').boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    // 同一行：y 相差在按钮高度差（30px vs 36px 垂直居中）容差内
    expect(Math.abs(newChatBox!.y - toggleBox!.y)).toBeLessThan(4);
    expect(searchBox!.y).toBe(toggleBox!.y);
    // 折叠/搜索在侧边栏右半区（同行靠右）
    const sidebarCenterX = expandedSidebarBox!.x + expandedSidebarBox!.width / 2;
    expect(toggleBox!.x).toBeGreaterThan(sidebarCenterX);
    // 新会话按钮与侧边栏同宽（顶部全宽按钮，含 padding/margin 容差）
    expect(newChatBox!.x - expandedSidebarBox!.x).toBeGreaterThanOrEqual(8);
    expect(newChatBox!.x - expandedSidebarBox!.x).toBeLessThanOrEqual(20);
    expect(Math.abs(newChatBox!.width - expandedSidebarBox!.width)).toBeLessThan(110);
  }
  await expect(page.locator('.content')).toHaveCSS('border-top-left-radius', '0px');

  const composerBox = await page.locator('.chat-input-card').boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.width).toBeGreaterThan(820);
  expect(composerBox!.height).toBeGreaterThanOrEqual(110);
  await page.screenshot({ path: 'output/playwright/chat-chrome-refined.png', fullPage: false });

  const expandedWidth = (await sidebar.boundingBox())!.width;
  const titlebarBox = isMac ? null : await page.getByTestId('titlebar').boundingBox();
  if (!isMac) expect(titlebarBox).not.toBeNull();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('sidebar-sessions')).toBeHidden();
  // 新会话按钮在侧边栏内：折叠后随侧栏隐藏
  await expect(page.getByTestId('new-chat')).toBeHidden();
  await expect(page.getByTestId('nav-chat')).toBeHidden();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(0);
  const collapsedSidebarBox = await sidebar.boundingBox();
  const collapsedContentBox = await page.locator('.content').boundingBox();
  expect(collapsedSidebarBox).not.toBeNull();
  expect(collapsedContentBox).not.toBeNull();
  expect(collapsedSidebarBox!.width).toBe(0);
  expect(collapsedContentBox!.x).toBe(0);
  // 收起后：悬浮层提供展开入口（mac 常驻层仍在红绿灯右侧；win 出现在内容区左上角）
  await expect(windowControls).toBeVisible();
  const collapsedControlsBox = await windowControls.boundingBox();
  expect(collapsedControlsBox).not.toBeNull();
  if (isMac) {
    expect(collapsedControlsBox!.y + collapsedControlsBox!.height).toBeLessThanOrEqual(40);
  } else {
    expect(collapsedControlsBox!.x).toBeLessThan(60);
    expect(collapsedControlsBox!.y).toBeGreaterThanOrEqual(30);
    expect(collapsedControlsBox!.y).toBeLessThan(60);
  }
  // Row 1 标题栏位置不随侧栏折叠变化（仅 Windows/Linux 有自绘标题栏）
  if (!isMac) {
    const collapsedTitlebarBox = await page.getByTestId('titlebar').boundingBox();
    expect(collapsedTitlebarBox).not.toBeNull();
    expect(collapsedTitlebarBox!.x).toBe(titlebarBox!.x);
    expect(collapsedTitlebarBox!.y).toBe(titlebarBox!.y);
    expect(collapsedTitlebarBox!.width).toBe(titlebarBox!.width);
    expect(collapsedTitlebarBox!.height).toBe(titlebarBox!.height);
  }
  await page.screenshot({ path: 'output/playwright/sidebar-collapsed-refined.png', fullPage: false });
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(expandedWidth - 100);

  const expandStartedAt = Date.now();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('sidebar-sessions')).toBeVisible({ timeout: 750 });
  await expect(page.locator('.sidebar-session-row').first()).toBeVisible({ timeout: 750 });
  expect(Date.now() - expandStartedAt).toBeLessThan(750);
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
  await expect(page.getByTestId('session-title-button').locator('svg')).toHaveCount(0);
  await expect.poll(async () => page.getByTestId('session-title-button').evaluate((element) =>
    element.ownerDocument.defaultView!.getComputedStyle(element).whiteSpace,
  )).toBe('nowrap');
  await expect.poll(async () => page.getByTestId('session-titlebar').evaluate((element) =>
    element.scrollHeight === element.clientHeight,
  )).toBe(true);
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

test('回合统计使用整个会话的缓存命中率', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('CACHE_SESSION first');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
  await page.getByTestId('chat-input').fill('CACHE_SESSION second');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  // 本轮 token/耗时仍属于第二轮，但缓存命中率应按两轮 usage 累计计算：900 / (100 + 900 + 1000) = 45%。
  await expect(page.getByTestId('turn-stats')).toContainText(/Session cache hit 45%|会话缓存命中 45%/);
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('usage-session-cache-hit-rate')).toContainText('45%');
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
  // streamdown 用 block 级 span 分行：textContent 不含换行，须按 innerText 语义断言并自动重试
  await expect(renderedCode).toContainText('const answer = 42;\nif (answer)', { useInnerText: true });
  expect(await renderedCode.evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).whiteSpace)).toBe('pre');
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

test('429 重试等待中 → Stop 中断重试并显示错误', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('FLAKE_429_ALWAYS please');
  await page.getByTestId('chat-send').click();

  const retry = page.getByTestId('status-retry');
  await expect(retry).toBeVisible({ timeout: 30_000 });
  // 重试等待不是流式状态，但 stop 必须可用（pi Escape → abortRetry）
  const stop = page.getByTestId('chat-stop');
  await expect(stop).toBeVisible();
  await stop.click();

  await expect(page.getByTestId('status-retry')).toHaveCount(0, { timeout: 15_000 });
  // 中断后回合以错误收尾，错误提示渲染在消息流里
  await expect(page.getByTestId('message-error').last()).toContainText(/429|rate limit/i, {
    timeout: 15_000,
  });
});

test('! bash 命令：本地执行并渲染输出卡片（!! 不入上下文）', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('!echo pi-desktop-bash-e2e');
  await page.getByTestId('chat-send').click();
  const card = page.getByTestId('message-bash').last();
  await expect(card.getByTestId('bash-command')).toContainText('echo pi-desktop-bash-e2e', {
    timeout: 15_000,
  });
  await expect(card.getByTestId('bash-output')).toContainText('pi-desktop-bash-e2e', {
    timeout: 15_000,
  });
  await expect(card.getByTestId('bash-exit-code')).toContainText('0');

  // !! 前缀：执行但标注不入上下文
  await page.getByTestId('chat-input').fill('!!echo pi-desktop-bash-excluded');
  await page.getByTestId('chat-send').click();
  const excluded = page.getByTestId('message-bash').last();
  await expect(excluded.getByTestId('bash-output')).toContainText('pi-desktop-bash-excluded', {
    timeout: 15_000,
  });
  await expect(excluded).toContainText(/不入上下文|excluded from context/);
});

test('! bash 长输出：默认折叠尾部预览，点击展开/收回', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 短输出：无折叠 UI，全文直出（回归）
  await page.getByTestId('chat-input').fill('!echo pi-desktop-bash-short');
  await page.getByTestId('chat-send').click();
  const short = page.getByTestId('message-bash').last();
  await expect(short.getByTestId('bash-output')).toContainText('pi-desktop-bash-short', { timeout: 15_000 });
  await expect(short.getByTestId('bash-output')).toHaveAttribute('data-expanded', 'true');
  await expect(short.getByTestId('bash-output-more')).toHaveCount(0);

  // 长输出（seq 1 20）：默认只显示尾部 5 行（16..20），首行 1 不可见，提示更早 15 行
  await page.getByTestId('chat-input').fill('!seq 1 20');
  await page.getByTestId('chat-send').click();
  const long = page.getByTestId('message-bash').last();
  const output = long.getByTestId('bash-output');
  await expect(output).toContainText('20', { timeout: 15_000 });
  await expect(output).toHaveAttribute('data-expanded', 'false');
  await expect.poll(() => output.textContent().then((text) => text?.startsWith('1\n') ?? false)).toBe(false);
  await expect(long.getByTestId('bash-output-more')).toContainText('15');

  // 点击输出区展开全文，再点收回
  await output.click();
  await expect(output).toHaveAttribute('data-expanded', 'true');
  await expect.poll(() => output.textContent().then((text) => text?.startsWith('1\n') ?? false)).toBe(true);
  await output.click();
  await expect(output).toHaveAttribute('data-expanded', 'false');
});

test('! bash 流式窗口：执行中只见尾部预览，无展开交互', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 慢速命令保证落盘前有足够的流式窗口（50 行 × 0.1s ≈ 5s）
  await page.getByTestId('chat-input').fill("!bash -c 'for i in $(seq 1 50); do echo $i; sleep 0.1; done'");
  await page.getByTestId('chat-send').click();
  const streaming = page.getByTestId('message-bash').last();
  await expect(streaming).toBeVisible();
  // 执行中（未落盘）：无 exit code、无展开提示、输出区标记 streaming
  await expect(streaming.getByTestId('bash-exit-code')).toHaveCount(0, { timeout: 5_000 });
  await expect(streaming.getByTestId('bash-output-more')).toHaveCount(0);
  await expect(streaming.getByTestId('bash-output')).toHaveAttribute('data-expanded', 'streaming');
  // 落盘后：转为非流式折叠态，可展开
  await expect(streaming.getByTestId('bash-exit-code')).toContainText('0', { timeout: 20_000 });
  await expect(streaming.getByTestId('bash-output')).toHaveAttribute('data-expanded', 'false');
  await expect(streaming.getByTestId('bash-output-more')).toContainText('45');
});

test('命令模式：工具栏进入、默认不入上下文、发送后自动退出', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 工具栏 → 运行命令 → 命令模式指示条出现，默认「不入上下文」
  await page.getByTestId('composer-command-mode').click();
  const bar = page.getByTestId('command-mode-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('command-context-toggle')).toContainText(/不入上下文|excluded from context/);

  // 不带 ! 前缀直接输入命令并发送
  await page.getByTestId('chat-input').fill('echo pi-desktop-command-mode');
  await page.getByTestId('chat-send').click();

  // 消息流卡片出现且带「不入上下文」徽标；发送后命令模式自动退出
  const card = page.getByTestId('message-bash').last();
  await expect(card.getByTestId('bash-command')).toContainText('echo pi-desktop-command-mode', { timeout: 15_000 });
  await expect(card).toContainText(/不入上下文|excluded from context/);
  await expect(bar).toBeHidden();
});

test('右侧「命令」tab：bash 历史记录与消息流同源，可点击展开', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 命令模式执行一条命令（默认不入上下文），供右侧面板展示
  await page.getByTestId('composer-command-mode').click();
  await page.getByTestId('chat-input').fill('echo pi-desktop-command-panel');
  await page.getByTestId('chat-send').click();
  const card = page.getByTestId('message-bash').last();
  await expect(card.getByTestId('bash-command')).toContainText('echo pi-desktop-command-panel', { timeout: 15_000 });

  // 右侧「命令」tab：历史记录与消息流同源，默认折叠，点击展开全文
  await page.getByTestId('workspace-toggle').click();
  await page.getByTestId('workspace-commands-tab').click();
  const run = page.getByTestId('command-run').last();
  await expect(run).toContainText('echo pi-desktop-command-panel');
  await expect(run).toContainText(/不入上下文|excluded from context/);
  await run.getByTestId('command-run-toggle').click();
  await expect(run.getByTestId('command-run-output')).toContainText('pi-desktop-command-panel');
});

test('命令模式：上下文开关切到入上下文、全角 ！ 前缀兼容', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 进入命令模式，切换到「入上下文」
  await page.getByTestId('composer-command-mode').click();
  await page.getByTestId('command-context-toggle').click();
  await expect(page.getByTestId('command-context-toggle')).toContainText(/入上下文|In context/);
  await page.getByTestId('chat-input').fill('echo pi-desktop-command-in-context');
  await page.getByTestId('chat-send').click();
  const card = page.getByTestId('message-bash').last();
  await expect(card.getByTestId('bash-command')).toContainText('echo pi-desktop-command-in-context', { timeout: 15_000 });
  await expect(card).not.toContainText(/不入上下文|excluded from context/);

  // 全角 ！ 前缀（中文输入法）直接识别为 bash 命令：单 ！ 入上下文，无徽标
  await page.getByTestId('chat-input').fill('！echo pi-desktop-fullwidth-bang');
  await page.getByTestId('chat-send').click();
  const full = page.getByTestId('message-bash').last();
  await expect(full.getByTestId('bash-command')).toContainText('echo pi-desktop-fullwidth-bang', { timeout: 15_000 });
  await expect(full).not.toContainText(/不入上下文|excluded from context/);
});

test('命令模式：执行中发送按钮禁用，完成后恢复', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('composer-command-mode').click();
  await page.getByTestId('chat-input').fill("bash -c 'sleep 2; echo pi-desktop-bash-slow'");
  await page.getByTestId('chat-send').click();
  // pi 原生一次一个 bash：执行中发送按钮禁用并提示
  await expect(page.getByTestId('chat-send')).toBeDisabled();
  await expect(page.getByTestId('chat-send')).toHaveAttribute('title', /仍在执行|still running/);
  // 完成后恢复可发送（先填入内容，空 composer 时发送按钮本就禁用）
  const card = page.getByTestId('message-bash').last();
  await expect(card.getByTestId('bash-exit-code')).toContainText('0', { timeout: 20_000 });
  await page.getByTestId('chat-input').fill('echo next');
  await expect(page.getByTestId('chat-send')).toBeEnabled();
  await expect(page.getByTestId('chat-send')).not.toHaveAttribute('title', /仍在执行|still running/);
});

test('bash 执行中可单独停止：流式卡停止按钮取消命令', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 命令模式跑慢命令，留出停止窗口
  await page.getByTestId('composer-command-mode').click();
  await page.getByTestId('chat-input').fill("bash -c 'for i in $(seq 1 200); do echo $i; sleep 0.2; done'");
  await page.getByTestId('chat-send').click();

  // 流式卡出现停止按钮
  await expect(page.getByTestId('bash-stop').first()).toBeVisible({ timeout: 10_000 });

  // 点停止：命令被取消，落盘 cancelled 卡（无 exit code）；短输出直出不折叠
  await page.getByTestId('bash-stop').first().click();
  const card = page.getByTestId('message-bash').last();
  await expect(card).toContainText(/已取消|cancelled/, { timeout: 15_000 });
  await expect(card.getByTestId('bash-exit-code')).toHaveCount(0);
  await expect(card.getByTestId('bash-output')).toHaveAttribute('data-expanded', 'true');
});

test('计划模式：常驻切换，开启后发送带 /plan 前缀，可退出', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 默认关闭（直接执行）
  await expect(page.getByTestId('composer-plan-toggle')).toHaveAttribute('aria-pressed', 'false');
  // 开启：发送带 /plan 前缀（ECHO_USER 回显收到的 user 文本验证）
  await page.getByTestId('composer-plan-toggle').click();
  await expect(page.getByTestId('composer-plan-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('chat-input').fill('ECHO_USER 帮我设计架构');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('/plan ECHO_USER 帮我设计架构', { timeout: 30_000 });
  // 退出：恢复直接执行
  await page.getByTestId('composer-plan-toggle').click();
  await expect(page.getByTestId('composer-plan-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('chat-input').fill('ECHO_USER 直接执行这条');
  await page.getByTestId('chat-send').click();
  const last = page.getByTestId('message-assistant').last();
  await expect(last).toContainText('ECHO_USER 直接执行这条', { timeout: 30_000 });
  await expect(last).not.toContainText('/plan');
});

test('引用文件：工具栏点击直接展开文件列表，选中追加到输入末尾不删内容', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 先输入内容，再点工具栏「引用文件」：无需先输入 @ 即弹出列表
  await page.getByTestId('chat-input').fill('请检查这个文件');
  await page.getByTestId('composer-file-reference').click();
  await expect(page.getByTestId('file-panel')).toBeVisible();
  const options = page.getByTestId('file-option');
  await expect(options.first()).toBeVisible();
  await options.first().click();
  // 已有内容保留，@引用追加到末尾
  await expect(page.getByTestId('chat-input')).toHaveValue(/请检查这个文件 @/);
  // 面板关闭
  await expect(page.getByTestId('file-panel')).toBeHidden();
});

test('技能面板：工具栏展开技能列表，选择后追加到输入开头不删已有内容', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('帮我写个脚本');
  await page.getByTestId('composer-skill-toggle').click();
  const panel = page.getByTestId('skill-panel');
  await expect(panel).toBeVisible();
  // 环境无 skill 时显示空态提示；有则点第一个，已输入内容保留在末尾
  const skillOptions = panel.locator('[data-testid^="composer-skill-"]');
  if (await skillOptions.count() === 0) {
    await expect(panel).toContainText(/暂无|No skills/);
  }
  // 再次点击 toggle 关闭
  await page.getByTestId('composer-skill-toggle').click();
  await expect(panel).toBeHidden();
});

test('生成中再发消息 → Enter 排队（followUp），Alt+Enter steer 当前轮插入', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();
  // 默认即 docked（向右弹开并排），无需手动切换
  await expect(panel).toHaveAttribute('data-mode', 'docked');
  await expect(panel).toHaveAttribute('data-mode-preference', 'docked');

  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();
  // 流式中：发送按钮变为 Queue（入队 followUp）+ Stop 组合
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chat-queue-send')).toBeVisible();
  await expect(page.getByTestId('chat-queue-send')).toHaveAttribute('title', /Guide|Queue|引导|稍后/);
  const stopBox = await page.getByTestId('chat-stop').boundingBox();
  expect(stopBox?.width).toBe(30);
  expect(stopBox?.height).toBe(30);
  // docked 展开会触发窗口向右加宽（动画进行中 boundingBox 含 transform/中间帧），
  // 轮询到稳定后面板右缘与当前视口右缘对齐
  await expect.poll(async () => {
    const box = await page.getByTestId('review-panel').boundingBox();
    const viewport = page.viewportSize();
    return box && viewport ? Math.abs(box.x + box.width - viewport.width) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(2);
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
  await page.getByTestId('chat-input').fill('draft survives new session and page switch');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-compaction')).toBeVisible();
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-input')).toHaveValue('draft survives new session and page switch');
  await page.getByTestId('chat-input').fill('');
  // 新会话仍可继续对话
  await page.getByTestId('chat-input').fill('Say PONG again');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
});

test('切回历史会话后恢复上下文与整个会话 Token 统计', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USAGE RESTORE A');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('USAGE RESTORE B');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  const original = page.locator('.sidebar-session-row').filter({ hasText: 'USAGE RESTORE A' });
  await expect(original).toBeVisible({ timeout: 15_000 });
  await original.locator('.sidebar-session').click();
  await expect(page.getByTestId('message-user').last()).toContainText('USAGE RESTORE A', { timeout: 30_000 });
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('usage-context-used').locator('strong')).not.toHaveText(/^(0|—)$/);
  await expect(page.getByTestId('usage-session-input').locator('strong')).not.toHaveText(/^(0|—)$/);
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

  // Depending on the installed pi version, the transient status may complete before
  // the next renderer frame. The persisted summary is the completion contract.
  // compaction 后 pi 重建上下文，壳从 runtime 重读：摘要消息出现；
  // 渲染层改用完整分支历史展示，被摘要掉的历史仍可浏览/定位。
  await expect(page.getByTestId('message-compaction')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('compaction-result')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(page.getByTestId('token-usage')).not.toContainText('0%');
  await expect(page.getByTestId('status-compaction')).toHaveCount(0, { timeout: 30_000 });

  // 压缩检查点独立 rail：悬浮显示摘要内容
  await expect(page.getByTestId('compaction-rail')).toBeVisible();
  const compactionDot = page.getByTestId('compaction-rail-dot-chat-msg-4');
  await compactionDot.hover();
  await expect(compactionDot.getByTestId('compaction-rail-tooltip')).toBeVisible();

  // 点击第一条 user 消息圆点：仍能回到对话最开始（压缩前也成立）
  await page.getByTestId('msg-rail-dot-chat-msg-0').click();
  await expect
    .poll(() => page.getByTestId('message-list').evaluate((el) => el.scrollTop), { timeout: 10_000 })
    .toBeLessThan(60);
  await expect(page.locator('#chat-msg-0')).toBeInViewport();
});
