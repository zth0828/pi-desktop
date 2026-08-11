// 用户消息导航 rail E2E（真 pi + mock provider，不烧 API quota）。
// 每条 user 消息一个圆点；点击平滑滚动到对应消息；当前可视位置附近的点高亮。
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

test('rail 圆点 = user 消息数；悬浮显示原问题，点击跳转并高亮', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  // 8 轮对话，保证消息列表溢出可滚动
  const rounds = 8;
  for (let i = 1; i <= rounds; i++) {
    await page.getByTestId('chat-input').fill(`Say PONG ${i}`);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-user')).toHaveCount(i, { timeout: 30_000 });
    await expect(page.getByTestId('message-assistant')).toHaveCount(i, { timeout: 30_000 });
  }

  const rail = page.getByTestId('msg-rail');
  await expect(rail).toBeVisible();
  await expect(rail.locator('.msg-rail-dot')).toHaveCount(rounds);

  const thirdDot = page.getByTestId('msg-rail-dot-chat-msg-4');
  await thirdDot.hover();
  await expect(thirdDot.getByTestId('msg-rail-tooltip')).toBeVisible();
  await expect(thirdDot.getByTestId('msg-rail-tooltip')).toHaveText('Say PONG 3');
  await page.screenshot({ path: 'output/playwright/nav-rail-tooltip.png', fullPage: false });

  // 新消息自动滚到底 → 列表已溢出、末位圆点高亮
  const list = page.getByTestId('message-list');
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId(`msg-rail-dot-chat-msg-${(rounds - 1) * 2}`)).toHaveClass(/active/);

  // 点击第一个圆点 → 平滑滚动回首条 user 消息
  await page.getByTestId('msg-rail-dot-chat-msg-0').click();
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop), { timeout: 10_000 })
    .toBeLessThan(60);
  await expect(page.locator('#chat-msg-0')).toBeInViewport();
  // 只允许滚动消息列表；不能让 scrollIntoView 带动外层 content，
  // 否则标题栏会被推离视口，composer 下方出现大片空白。
  await expect.poll(() => page.locator('.content').evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByTestId('session-titlebar')).toBeInViewport();
  await expect(page.getByTestId('chat-input')).toBeInViewport();
  // 高亮跟随可视区：顶部位置高亮前几条的圆点之一（TOC 语义：读线之上最后一条）
  await expect(rail.locator('.msg-rail-dot.active')).toHaveCount(1);
  const activeId = await rail.locator('.msg-rail-dot.active').getAttribute('data-testid');
  expect([
    'msg-rail-dot-chat-msg-0',
    'msg-rail-dot-chat-msg-2',
    'msg-rail-dot-chat-msg-4',
  ]).toContain(activeId);

  // 上滑后显示回到底部入口；点击后恢复自动跟随底部。
  await expect(page.getByTestId('scroll-to-bottom')).toBeVisible();
  await page.screenshot({ path: 'output/playwright/scroll-to-bottom.png', fullPage: false });
  await page.getByTestId('scroll-to-bottom').click();
  await expect(page.getByTestId('scroll-to-bottom')).toBeHidden();
  await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
});
