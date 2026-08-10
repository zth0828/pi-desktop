// M3 验收：providers 管理 + / 命令补全。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
            {
              id: 'mock-wide',
              name: 'Mock Wide',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 8192,
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
        lmstudio: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          apiKey: 'lm-studio',
          models: [
            {
              id: 'stale-manual-model',
              name: 'Stale manual model (LM Studio)',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              maxTokens: 8192,
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }),
  );
});

test.afterEach(async () => {
  // app 可能仍在写 agentDir（session/settings 落盘），rm 加重试吸收竞态
  await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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

test('Models 页：已配置供应商展开显示可用模型，可设为当前模型并持久化', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-mock');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.provider-row-header').click();

  // 展开区域列出该供应商的可用模型
  const modelList = page.getByTestId('provider-models-mock');
  await expect(modelList).toBeVisible();
  await expect(page.getByTestId('provider-model-mock-mock-1')).toBeVisible();
  await expect(page.getByTestId('provider-model-mock-mock-wide')).toBeVisible();

  // fixture 默认模型是 mock-1 → mock-wide 初始非「当前」，显示设为当前按钮
  await expect(page.getByTestId('set-current-mock-mock-wide')).toBeVisible();
  await page.getByTestId('set-current-mock-mock-wide').click();

  // 设为当前后：标记出现，且 pi settings.json 持久化 defaultProvider/defaultModel
  await expect(page.getByTestId('current-model-mock-mock-wide')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        try {
          const settings = JSON.parse(
            await readFile(path.join(agentDir, 'settings.json'), 'utf8'),
          ) as { defaultProvider?: string; defaultModel?: string };
          return `${settings.defaultProvider}/${settings.defaultModel}`;
        } catch {
          return '';
        }
      },
      { timeout: 15_000 },
    )
    .toBe('mock/mock-wide');

  // 新会话启动时应用首选模型
  await page.getByTestId('nav-chat').click();
  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await expect(selector).toHaveAttribute('data-value', 'mock/mock-wide');
  await page.getByTestId('new-chat').click();
  await expect
    .poll(async () => selector.getAttribute('data-value'), { timeout: 15_000 })
    .toBe('mock/mock-wide');
});

/** Codex 风格模型菜单：触发器 → 「模型」行 → 子菜单里按 data-value 点选 */
async function selectChatModel(page: import('@playwright/test').Page, value: string) {
  await page.getByTestId('model-select').click();
  await page.getByTestId('model-menu-models').click();
  await page.locator(`[data-testid="model-option"][data-value="${value}"]`).click();
}

test('聊天页模型菜单按供应商分组', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await page.getByTestId('model-menu-models').click();
  const submenu = page.getByTestId('model-submenu');
  await expect(submenu).toBeVisible();
  const mockGroup = submenu.locator('> div', {
    has: page.locator('.model-group-label', { hasText: 'mock' }),
  });
  await expect(mockGroup).toHaveCount(1);
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(2);
});

test('LM Studio：自动发现模型并同步视觉能力与真实上下文', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await page.getByTestId('model-menu-models').click();
  const group = page.locator('.model-submenu > div', {
    has: page.locator('.model-group-label', { hasText: 'LM Studio' }),
  });
  await expect(group).toHaveCount(1);
  await expect(group.getByTestId('model-option')).toHaveText(['Qwen3.5 9B']);
  await selector.click();

  await expect.poll(async () => {
    const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: { lmstudio: { models: Array<{ id: string; input: string[]; reasoning: boolean; contextWindow: number }> } };
    };
    return doc.providers.lmstudio.models[0];
  }).toMatchObject({
    id: 'qwen/qwen3.5-9b',
    input: ['text', 'image'],
    reasoning: true,
    contextWindow: 262144,
  });
});

test('Models 页：自定义供应商表单的 API 类型可选', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();

  const apiSelect = page.getByTestId('custom-api-select');
  await expect(apiSelect).toBeVisible();
  await expect(apiSelect).toHaveValue('openai-completions');
  await expect(apiSelect.locator('option')).toHaveText([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
  ]);
  await apiSelect.selectOption('openai-responses');
  await expect(apiSelect).toHaveValue('openai-responses');
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

test('Token 上限随当前模型切换，不使用固定 128K', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('token-usage').click();
  const popover = page.getByTestId('token-usage-popover');
  await expect(popover).toContainText('128,000');
  await expect(popover).toContainText('4,096');

  // 菜单点选会顺带关闭 usage popover（外部点击语义），选完重新打开
  await selectChatModel(page, 'mock/mock-wide');
  await page.getByTestId('token-usage').click();
  await expect(popover.getByTestId('usage-context-window')).toContainText('200,000');
  await expect(popover.getByTestId('usage-max-output')).toContainText('8,192');
});

test('模型切换只更新当前模型参数，会话累计 usage 保持不变', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  await page.getByTestId('token-usage').click();
  const inputTotal = page.getByTestId('usage-session-input');
  await expect.poll(async () => Number((await inputTotal.locator('strong').textContent())?.replaceAll(',', '') ?? 0)).toBeGreaterThan(0);
  const before = await inputTotal.locator('strong').textContent();
  await selectChatModel(page, 'mock/mock-wide');
  // 重新打开 usage popover（菜单点选按外部点击关掉了它）
  await page.getByTestId('token-usage').click();
  await expect(page.getByTestId('usage-context-window')).toContainText('200,000');
  await expect(inputTotal.locator('strong')).toHaveText(before ?? '');
});
