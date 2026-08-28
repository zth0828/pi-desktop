// 系统通知 E2E（真 pi + mock provider，不烧 API quota）。
// main 侧 Notification 无法在无签名构建上直接断言，改用观测钩子：
// notify-api 在 PI_DESKTOP_E2E_NOTIFY_LOG 指向的文件里按行落 JSON（决定弹通知时）。
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
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

const launchOptions = (notifyMode: 'always' | 'unfocused' | 'off') => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace, notifyMode },
});

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 发一条消息并等 mock 回复落地（保证会话文件已写入） */
async function sendAndWaitReply(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

/** 右键侧栏会话行 →「Open in separate window」，返回新窗口 Page */
async function openDetachedWindow(
  app: ElectronApplication,
  page: import('@playwright/test').Page,
  sessionText: string,
): Promise<import('@playwright/test').Page> {
  const row = page.locator('.sidebar-session-row').filter({ hasText: sessionText });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  const sessionTestId = await sessionButton.getAttribute('data-testid');
  const sessionId = sessionTestId?.replace('sidebar-session-', '');
  expect(sessionId).toBeTruthy();

  const windowPromise = app.waitForEvent('window');
  await row.click({ button: 'right' });
  await page.getByTestId(`sidebar-session-open-detached-${sessionId}`).click();
  const detached = await windowPromise;
  await detached.waitForLoadState('domcontentloaded');
  return detached;
}

/** 侧栏会话行 title 属性即会话文件路径（SessionList 里 title={session.path}） */
async function sessionPathOf(page: import('@playwright/test').Page, sessionText: string): Promise<string> {
  const row = page.locator('.sidebar-session-row').filter({ hasText: sessionText });
  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  const sessionPath = await sessionButton.getAttribute('title');
  expect(sessionPath).toBeTruthy();
  return sessionPath!;
}

/** 经 hostInvoke 读 windows.list（窗口↔会话绑定 + 聚焦状态） */
async function listHostWindows(page: import('@playwright/test').Page): Promise<Array<{
  windowId: number;
  sessionPath: string | null;
  isMain: boolean;
  focused: boolean;
}>> {
  return page.evaluate(async () => {
    const bridge = (globalThis as unknown as {
      pidesktop: {
        hostInvoke: (request: unknown) => Promise<{ ok: boolean; data?: unknown }>;
      };
    }).pidesktop;
    const response = await bridge.hostInvoke({
      id: 'e2e-windows-list',
      module: 'windows',
      action: 'list',
    });
    if (!response.ok) throw new Error('windows.list failed');
    return response.data as Array<{
      windowId: number;
      sessionPath: string | null;
      isMain: boolean;
      focused: boolean;
    }>;
  });
}

/** 经 hostInvoke 走 app 自身 focus 路径（windows.focus → win.focus()），跨窗口改 OS 焦点 */
async function focusSessionWindow(page: import('@playwright/test').Page, sessionPath: string): Promise<void> {
  await page.evaluate(async (path) => {
    const bridge = (globalThis as unknown as {
      pidesktop: {
        hostInvoke: (request: unknown) => Promise<{ ok: boolean }>;
      };
    }).pidesktop;
    const response = await bridge.hostInvoke({
      id: 'e2e-focus-session',
      module: 'windows',
      action: 'focus',
      payload: { sessionPath: path },
    });
    if (!response.ok) throw new Error('windows.focus failed');
  }, sessionPath);
}

async function readLog(logPath: string): Promise<string> {
  if (!existsSync(logPath)) return '';
  return readFile(logPath, 'utf8');
}

async function readEntries(logPath: string): Promise<Array<{
  kind: string;
  title?: string;
  body?: string;
  sessionPath?: string;
}>> {
  const raw = await readLog(logPath);
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('设置页通知档位开关写入 electron-store', async ({ launchElectronApp, homeDir }) => {
  const app = await launchElectronApp({ withPi: true, agentDir, initialPage: 'settings' });
  const page = await app.firstWindow();

  await expect(page.getByTestId('settings-notify-mode')).toBeVisible({ timeout: 30_000 });
  // 默认档：仅失焦
  await expect(page.getByTestId('notify-mode-unfocused')).toHaveClass(/active/);

  await page.getByTestId('notify-mode-off').click();
  await expect(page.getByTestId('notify-mode-off')).toHaveClass(/active/);
  // electron-store 落盘：<userData>/config.json（userData 被测试钩子固定到 homeDir/user-data）
  const configPath = path.join(homeDir, 'user-data', 'config.json');
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readLog(configPath)).notifyMode;
      } catch {
        return undefined;
      }
    })
    .toBe('off');
});

test('run 完成 → always 档弹出系统通知（含摘要）', async ({ launchElectronApp, homeDir }) => {
  const logPath = path.join(homeDir, 'notify.log');
  process.env.PI_DESKTOP_E2E_NOTIFY_LOG = logPath;
  try {
    const app = await launchElectronApp(launchOptions('always'));
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('chat-input').fill('Say PONG');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
      timeout: 30_000,
    });

    await expect.poll(async () => readLog(logPath), { timeout: 10_000 }).toContain('runCompleted');
    const entry = JSON.parse((await readLog(logPath)).trim().split('\n')[0]);
    expect(entry.title).toBeTruthy();
    expect(entry.body).toContain('PONG');
    // 会话已落盘：通知 payload 带会话文件路径，供 main 按会话定位窗口
    expect(entry.sessionPath).toBeTruthy();
  } finally {
    delete process.env.PI_DESKTOP_E2E_NOTIFY_LOG;
  }
});

test('run 完成 → off 档不弹通知', async ({ launchElectronApp, homeDir }) => {
  const logPath = path.join(homeDir, 'notify.log');
  process.env.PI_DESKTOP_E2E_NOTIFY_LOG = logPath;
  try {
    const app = await launchElectronApp(launchOptions('off'));
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('chat-input').fill('Say PONG');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
      timeout: 30_000,
    });

    // 回复渲染后 run.ended 已同步派发；给通知通道留一个窗口期再断言无记录
    await page.waitForTimeout(1_500);
    expect(await readLog(logPath)).not.toContain('runCompleted');
  } finally {
    delete process.env.PI_DESKTOP_E2E_NOTIFY_LOG;
  }
});

test('多窗口：焦点按会话窗口判定（B 窗口完成弹、A 窗口完成不弹）', async ({
  launchElectronApp,
  homeDir,
}) => {
  const logPath = path.join(homeDir, 'notify.log');
  process.env.PI_DESKTOP_E2E_NOTIFY_LOG = logPath;
  try {
    const app = await launchElectronApp(launchOptions('unfocused'));
    const page = await app.firstWindow();
    await waitSessionReady(page);

    // 主窗口建 ALPHA 会话后切到 BETA（否则 ALPHA 仍是主窗口面板，detach 只会激活不建窗）
    await sendAndWaitReply(page, 'Say PONG multiwin ALPHA');
    await page.getByTestId('new-chat').click();
    await sendAndWaitReply(page, 'Say PONG main BETA');
    const alphaPath = await sessionPathOf(page, 'multiwin ALPHA');

    const detached = await openDetachedWindow(app, page, 'multiwin ALPHA');
    await expect.poll(() => app.windows().length).toBe(2);
    await waitSessionReady(detached);

    // 独立窗口（会话 ALPHA）发起慢速 run，随后把主窗口拉到前台：
    // run 完成时 ALPHA 窗口失焦 → unfocused 档应弹通知（核心修复点）。
    // 跨窗口改 OS 焦点只能走 app 自身 focus 路径（CDP 输入事件不改变窗口叠层）。
    // 快照当前日志条数：之前的 run（如窗口未获 OS 焦点的环境）可能已写通知，
    // 只断言本次 SLOW_END run 之后新增的条目。
    const entriesBefore = (await readEntries(logPath)).length;
    await detached.getByTestId('chat-input').fill('Say SLOW_END B-notify');
    await detached.getByTestId('chat-send').click();
    const betaPath = await sessionPathOf(page, 'main BETA');
    await focusSessionWindow(page, betaPath);
    // 前置确认：主窗口聚焦、独立窗口失焦（环境聚焦失效时显式失败而非静默跳过）
    await expect.poll(async () => {
      const listed = await listHostWindows(page);
      return listed.find((entry) => entry.isMain)?.focused === true && listed.find((entry) => !entry.isMain)?.focused === false;
    }, { timeout: 10_000 }).toBe(true);

    await expect(detached.getByTestId('message-assistant').last()).toContainText('chunk29', {
      timeout: 30_000,
    });
    await expect
      .poll(async () => (await readEntries(logPath)).slice(entriesBefore).some((entry) => entry.sessionPath === alphaPath), {
        timeout: 10_000,
      })
      .toBe(true);
    const bEntry = (await readEntries(logPath)).slice(entriesBefore).find((entry) => entry.sessionPath === alphaPath);
    expect(bEntry?.kind).toBe('runCompleted');
    expect(bEntry?.body).toContain('chunk');

    // 独立窗口自身聚焦时完成 run → 会话窗口聚焦 → 不弹通知
    const before = (await readEntries(logPath)).length;
    await focusSessionWindow(detached, alphaPath);
    await detached.getByTestId('chat-input').fill('Say SLOW_END B-focused');
    await detached.getByTestId('chat-send').click();
    await expect(detached.getByTestId('message-assistant').last()).toContainText('chunk29', {
      timeout: 30_000,
    });
    await page.waitForTimeout(1_500);
    expect(await readEntries(logPath)).toHaveLength(before);
  } finally {
    delete process.env.PI_DESKTOP_E2E_NOTIFY_LOG;
  }
});
