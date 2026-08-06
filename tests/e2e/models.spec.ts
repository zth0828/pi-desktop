// M3 验收：providers 管理 + / 命令补全。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let agentDir: string;
let workspace: string;
let mockPort: number;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock timeout')), 10_000);
  });

  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
  // / 补全数据源：项目级 prompt 模板
  await mkdir(path.join(workspace, '.pi/prompts'), { recursive: true });
  await writeFile(
    path.join(workspace, '.pi/prompts/deploy.md'),
    '---\ndescription: Deploy the app\n---\nDeploy step 1. Deploy step 2.',
  );
});

// 每个测试独立 agentDir（auth.json 互相隔离），并锁定默认模型为 mock，
// 防止已保存的 key 改变「首个可用模型」的解析结果
test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
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
        // 无 apiKey 的自定义供应商：login('api_key') 不触发远程刷新，确定性测试
        customnoauth: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          models: [
            {
              id: 'mock-2',
              name: 'Mock 2',
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
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultModel: 'mock/mock-1' }),
  );
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
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

test('Models 页：provider 列表与认证状态灯', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const mockRow = page.getByTestId('provider-mock');
  await expect(mockRow).toBeVisible({ timeout: 30_000 });
  // models.json 里有 apiKey → configured 绿灯
  await expect(page.getByTestId('provider-status-mock')).toHaveClass(/configured/);
  // 内置 provider（如 anthropic）未配置 → 无 configured
  await expect(page.getByTestId('provider-anthropic')).toBeVisible();
  await expect(page.getByTestId('provider-status-anthropic')).not.toHaveClass(/configured/);
});

test('Models 页：录入 API key 后状态变已配置', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-customnoauth');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('provider-status-customnoauth')).not.toHaveClass(/configured/);
  await row.locator('.provider-row-header').click();
  await page.getByTestId('key-input-customnoauth').fill('sk-test-fake-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByTestId('provider-status-customnoauth')).toHaveClass(/configured/, {
    timeout: 15_000,
  });
});

test('/ 命令补全：内置命令 + prompt 模板，选中可发送', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  const input = page.getByTestId('chat-input');
  await input.fill('/');
  const panel = page.getByTestId('command-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('command-new')).toBeVisible();
  await expect(page.getByTestId('command-compact')).toBeVisible();
  await expect(page.getByTestId('command-deploy')).toBeVisible();

  // 过滤
  await input.fill('/dep');
  await expect(page.getByTestId('command-new')).not.toBeVisible();
  await page.getByTestId('command-deploy').click();
  await expect(input).toHaveValue('/deploy ');

  // 发送：pi 展开模板（用户消息显示展开后内容）→ mock 回复
  await input.press('Enter');
  await expect(page.getByTestId('message-user').last()).toContainText('Deploy step 1');
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
});

test('/ 内置命令：/new 直接开新会话', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });

  await page.getByTestId('chat-input').fill('/new');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('message-assistant')).toHaveCount(0);
});
