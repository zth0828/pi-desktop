// 系统通知 E2E（真 pi + mock provider，不烧 API quota）。
// main 侧 Notification 无法在无签名构建上直接断言，改用观测钩子：
// notify-api 在 PI_DESKTOP_E2E_NOTIFY_LOG 指向的文件里按行落 JSON（决定弹通知时）。
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

async function readLog(logPath: string): Promise<string> {
  if (!existsSync(logPath)) return '';
  return readFile(logPath, 'utf8');
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
