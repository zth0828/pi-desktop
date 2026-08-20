// 供应商错误归属提示 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖：503 上游故障 → upstream 提示；401 无效 key → invalid-key 提示 + 请求 ID。
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
  // 关闭自动重试：错误必须在首轮直接浮出，否则 503/429 会被 pi 吞掉重试。
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ retry: { enabled: false } }),
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

test('上游 503 → 显示 upstream 归属提示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ERR_UPSTREAM_503');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('message-error').last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-error').last()).toContainText('Service temporarily unavailable');
  await expect(page.getByTestId('message-assistant').last().getByText('Service temporarily unavailable', { exact: false })).toHaveCount(1);
  await expect(page.getByTestId('error-hint-upstream')).toBeVisible();
});

test('上游 server_is_overloaded → upstream 归属提示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ERR_OVERLOADED');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('error-hint-upstream')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-error').last()).toContainText('server_is_overloaded');
});

test('上游 auth_unavailable 503 → upstream 归属提示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ERR_AUTH_UNAVAILABLE');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('error-hint-upstream')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-error').last()).toContainText('auth_unavailable');
});

test('401 无效 key → invalid-key 归属提示 + 请求 ID', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ERR_INVALID_KEY');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('error-hint-invalid-key')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-error').last()).toContainText('202608200646490268733188268d9d6FgctFa43');
});

test('503 model_not_found → wrong-model 归属提示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ERR_MODEL_NOT_FOUND');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('error-hint-wrong-model')).toBeVisible({ timeout: 30_000 });
});

test('429 usage_limit → quota 归属提示', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ERR_QUOTA');
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('error-hint-quota')).toBeVisible({ timeout: 30_000 });
});
