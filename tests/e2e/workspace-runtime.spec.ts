// 工作区边界与长驻命令：真 pi + mock provider，覆盖 Desktop 对 pi 原生 runtime 的补充约束。
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from './fixtures/electron';

const outsideFile = '/tmp/pi-desktop-outside-e2e.txt';
let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs')]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (data) => {
      const match = String(data).match(/MOCK_PORT=(\d+)/);
      if (match) resolvePort(Number(match[1]));
    });
    setTimeout(() => reject(new Error('mock server timeout')), 10_000);
  });
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
  await writeFile(path.join(workspace, 'server.js'), "setInterval(() => console.log('server listening'), 1000);\n");
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      mock: {
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        api: 'openai-completions',
        apiKey: 'mock-key',
        models: [{ id: 'mock-1', name: 'Mock 1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
      },
    },
  }));
});

test.afterAll(async () => {
  mock?.kill();
  await rm(outsideFile, { force: true });
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

const launchOptions = () => ({ withPi: true, agentDir, seedSettings: { workspaceCwd: workspace } });

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('model-select').or(page.getByTestId('model-badge')).first()).toBeVisible({ timeout: 30_000 });
}

async function revealCurrentTools(page: import('@playwright/test').Page) {
  const fold = page.getByTestId('turn-fold-toggle').last();
  await expect(fold).toBeVisible({ timeout: 30_000 });
  await fold.click();
  await page.getByTestId('process-stage-toggle').last().click();
}

test('越界 write 会被 pi Desktop 工作区扩展拦截', async ({ launchElectronApp }) => {
  await rm(outsideFile, { force: true });
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_WRITE_OUTSIDE');
  await page.getByTestId('chat-send').click();
  await revealCurrentTools(page);

  const tool = page.getByTestId('tool-card').last();
  await expect(tool.locator('.tool-status')).toHaveText('error');
  expect(existsSync(outsideFile)).toBe(false);
});

test('前台开发服务显示明确状态且可停止', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('USE_TOOL_FOREGROUND_SERVER');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('status-server-running')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('status-server-running')).toContainText('foreground');
  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('status-server-running')).toHaveCount(0, { timeout: 30_000 });
});
