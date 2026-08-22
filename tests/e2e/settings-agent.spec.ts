// 设置页 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖：Agent/代理设置渲染 + 切换落盘 config.json；followupBehavior=steer 时流式中
// Enter 直接 steering 入队；sendWith=cmdEnter 时 Enter 换行、Cmd+Enter 发送；
// preventSleep 时 run 期间 powerSaveBlocker start/stop（观测钩子 PI_DESKTOP_E2E_POWER_LOG，
// 同 notify 的 PI_DESKTOP_E2E_NOTIFY_LOG 模式）。
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  // 默认模型用于解析设置页的模型窗口（compaction 推荐值依赖它）
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }));
});

test.afterAll(async () => {
  mock?.kill();
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function readConfig(homeDir: string): Promise<Record<string, unknown>> {
  const configPath = path.join(homeDir, 'user-data', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readLog(logPath: string): Promise<string> {
  if (!existsSync(logPath)) return '';
  return readFile(logPath, 'utf8');
}

test('设置页：Agent 与代理设置渲染 + 切换后落盘 config.json', async ({ launchElectronApp, homeDir }) => {
  const app = await launchElectronApp({ withPi: true, agentDir, initialPage: 'settings' });
  const page = await app.firstWindow();

  // 渲染 + 默认值
  await expect(page.getByTestId('settings-followup-behavior')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('followup-queue')).toHaveClass(/active/);
  await expect(page.getByTestId('settings-send-with')).toBeVisible();
  await expect(page.getByTestId('send-with-enter')).toHaveClass(/active/);
  await expect(page.getByTestId('settings-prevent-sleep')).toBeVisible();
  await expect(page.getByTestId('prevent-sleep-off')).toHaveClass(/active/);
  await expect(page.getByTestId('settings-notify-ui-request')).toBeVisible();
  await expect(page.getByTestId('notify-ui-request-on')).toHaveClass(/active/);
  await expect(page.getByTestId('settings-compaction')).toBeVisible();
  await expect(page.getByTestId('settings-compaction-enabled')).toBeVisible();
  await expect(page.getByTestId('compaction-enabled-on')).toHaveClass(/active/);
  await expect(page.getByTestId('compaction-reserve')).toHaveValue('16384');
  // 未显式配置过 compaction 时按模型窗口（mock-1 = 128000）套用推荐保留值：128000 × 25% = 32000
  await expect(page.getByTestId('compaction-keep-recent')).toHaveValue('32000');
  // 推荐值写回 pi settings.json（供新会话生效）
  await expect
    .poll(async () => {
      const settings = JSON.parse(await readFile(path.join(agentDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
      return (settings.compaction as Record<string, unknown> | undefined)?.keepRecentTokens;
    }, { timeout: 10_000 })
    .toBe(32000);
  await expect(page.getByTestId('settings-proxy')).toBeVisible();
  await expect(page.getByTestId('proxy-mode-auto')).toHaveClass(/active/);
  await expect(page.getByTestId('proxy-mode-manual')).toHaveCount(0);
  await expect(page.getByTestId('settings-proxy-url')).toHaveValue('http://127.0.0.1:7897');
  const sectionBorders = await page.locator('.settings-section').evaluateAll((sections) =>
    sections.slice(0, 2).map((section) =>
      section.ownerDocument.defaultView?.getComputedStyle(section).borderColor ?? '',
    ),
  );
  expect(sectionBorders[1]).toBe(sectionBorders[0]);

  const settingsPage = page.locator('.settings-page');
  await expect(settingsPage).toHaveCSS('scrollbar-width', 'none');
  await settingsPage.evaluate((element) => { element.scrollTop = 0; });
  await settingsPage.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => settingsPage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  // 切换 → 落盘（electron-store：<userData>/config.json）
  await page.getByTestId('followup-steer').click();
  await expect(page.getByTestId('followup-steer')).toHaveClass(/active/);
  await page.getByTestId('send-with-cmdEnter').click();
  await page.getByTestId('prevent-sleep-on').click();
  await page.getByTestId('notify-ui-request-off').click();
  await page.getByTestId('compaction-enabled-off').click();
  await expect(page.getByTestId('compaction-enabled-off')).toHaveClass(/active/);
  await page.getByTestId('proxy-mode-off').click();
  await expect(page.getByTestId('proxy-mode-off')).toHaveClass(/active/);
  await expect(page.getByTestId('settings-proxy-url')).toHaveCount(0);
  await page.getByTestId('proxy-mode-auto').click();
  await expect(page.getByTestId('settings-proxy-url')).toHaveValue('http://127.0.0.1:7897');

  await expect
    .poll(async () => (await readConfig(homeDir)).followupBehavior, { timeout: 10_000 })
    .toBe('steer');
  await expect.poll(async () => (await readConfig(homeDir)).sendWith).toBe('cmdEnter');
  await expect.poll(async () => (await readConfig(homeDir)).preventSleep).toBe(true);
  await expect.poll(async () => (await readConfig(homeDir)).notifyUiRequest).toBe(false);
  await expect.poll(async () => (await readConfig(homeDir)).httpProxyMode).toBe('auto');
  await expect.poll(async () => (await readConfig(homeDir)).httpProxyUrl).toBe('http://127.0.0.1:7897');
});

test('followupBehavior=steer：流式中 Enter 直接 steering 入队，Alt+Enter 反向排队', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace, followupBehavior: 'steer' },
  });
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // SLOW 流式窗口（30 chunk × 100ms）
  await page.getByTestId('chat-input').fill('SLOW stream please');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });

  // Enter = steer（设置值）
  await page.getByTestId('chat-input').fill('steer by default');
  await page.getByTestId('chat-input').press('Enter');
  const steering = page.getByTestId('queue-item-steering');
  await expect(steering).toBeVisible({ timeout: 30_000 });
  await expect(steering).toContainText('steer by default');

  // Alt+Enter = 反向（排队 followUp）
  await page.getByTestId('chat-input').fill('alt queues instead');
  await page.getByTestId('chat-input').press('Alt+Enter');
  const followUp = page.getByTestId('queue-item-followUp');
  await expect(followUp).toBeVisible({ timeout: 30_000 });
  await expect(followUp).toContainText('alt queues instead');

  await page.getByTestId('chat-stop').click();
});

test('sendWith=cmdEnter：Enter 换行不发送，Cmd+Enter 发送', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace, sendWith: 'cmdEnter' },
  });
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const input = page.getByTestId('chat-input');
  await input.fill('Say PONG');
  // 裸 Enter = 换行（不发送）
  await input.press('Enter');
  await expect(page.getByTestId('message-user')).toHaveCount(0);
  await expect(input).toHaveValue(/Say PONG\n/);

  // Cmd+Enter = 发送
  await input.press('Meta+Enter');
  await expect(page.getByTestId('message-user').last()).toContainText('Say PONG', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
});

test('preventSleep=on：run 期间 powerSaveBlocker start → 结束 stop', async ({
  launchElectronApp,
  homeDir,
}) => {
  const logPath = path.join(homeDir, 'power.log');
  process.env.PI_DESKTOP_E2E_POWER_LOG = logPath;
  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace, preventSleep: true },
    });
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('chat-input').fill('SLOW stream please');
    await page.getByTestId('chat-send').click();
    // SLOW 挂起窗口（mock 的 SSE 流不会自然结束）：run 期间 blocker 应启动
    await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => readLog(logPath), { timeout: 15_000 })
      .toContain('"action":"start"');
    // 中止 run → run.ended → blocker 应解除
    await page.getByTestId('chat-stop').click();
    await expect.poll(async () => readLog(logPath)).toContain('"action":"stop"');
    // start 在 stop 之前
    const log = await readLog(logPath);
    expect(log.indexOf('"action":"start"')).toBeLessThan(log.indexOf('"action":"stop"'));
  } finally {
    delete process.env.PI_DESKTOP_E2E_POWER_LOG;
  }
});

test('preventSleep 缺省（关）：run 不触发 powerSaveBlocker', async ({
  launchElectronApp,
  homeDir,
}) => {
  const logPath = path.join(homeDir, 'power.log');
  process.env.PI_DESKTOP_E2E_POWER_LOG = logPath;
  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace },
    });
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('chat-input').fill('Say PONG');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
      timeout: 30_000,
    });

    // 回复渲染后 run.ended 已同步派发；留窗口期再断言无记录
    await page.waitForTimeout(1_500);
    expect(await readLog(logPath)).not.toContain('"action":"start"');
  } finally {
    delete process.env.PI_DESKTOP_E2E_POWER_LOG;
  }
});
