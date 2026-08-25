// providers 管理 + / 命令补全 E2E。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';
import { seedTrustedWorkspace } from '../helpers/trust';

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
  await seedTrustedWorkspace(agentDir, workspace);
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
  const providerExtensionDir = path.join(agentDir, 'extensions', 'e2e-provider');
  await mkdir(providerExtensionDir, { recursive: true });
  await writeFile(path.join(providerExtensionDir, 'index.ts'), `
export default function (pi: any) {
  pi.registerProvider('extension-models', {
    baseUrl: 'http://127.0.0.1:${mockPort}/v1',
    apiKey: 'extension-key',
    api: 'openai-completions',
    models: [{
      id: 'extension-1',
      name: 'Extension Model 1',
      reasoning: false,
      input: ['text'],
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
      contextWindow: 64000,
      maxTokens: 4096,
    }],
  });
}
`);
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
  await expect(page.getByTestId('provider-model-customnoauth-mock-discovered')).toBeVisible({
    timeout: 15_000,
  });
  await expect(row).toContainText('Found 2 models, including 1 new');
  await expect.poll(async () => {
    const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: { customnoauth: { models: Array<{ id: string }> } };
    };
    return doc.providers.customnoauth.models.map((model) => model.id);
  }).toContain('mock-discovered');
});

test('Models 页：删除旧版内联凭证会清空 key、模型和可用状态', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-mock');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.provider-row-header').click();
  await expect(page.getByTestId('provider-model-mock-mock-1')).toBeVisible();
  await page.getByTestId('remove-credential-mock').click();

  await expect(page.getByTestId('provider-status-mock')).not.toHaveClass(/configured/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('provider-models-mock')).not.toBeVisible();
  await expect.poll(async () => {
    const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: { mock: { apiKey?: string; models?: unknown[] } };
    };
    return { hasKey: Boolean(doc.providers.mock.apiKey), models: doc.providers.mock.models?.length };
  }).toEqual({ hasKey: false, models: 0 });
});

test('Models 页：新增供应商使用 pi auth storage，并可整项删除', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();
  const form = page.getByTestId('custom-provider-form');
  await form.getByPlaceholder('Provider name (e.g. My LLM)').fill('Added Provider');
  await form.getByPlaceholder('baseURL').fill(`http://127.0.0.1:${mockPort}/v1`);
  await form.getByPlaceholder('API key').fill('added-secret');
  await expect(form.getByTestId('custom-api-select')).toHaveCount(0);
  await expect(form.getByTestId('custom-models')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Save provider' })).toBeDisabled();
  await form.getByTestId('probe-custom-provider').click();
  await expect(form.getByTestId('custom-api-select')).toHaveValue('openai-responses', { timeout: 30_000 });
  await expect(form.getByTestId('probe-models')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save provider' })).toBeEnabled();
  await form.getByRole('button', { name: 'Save provider' }).click();

  const added = page.getByTestId('provider-added-provider');
  await expect(added).toBeVisible({ timeout: 15_000 });
  await expect(added.locator('.provider-name')).toHaveText('Added Provider');
  await expect(page.getByTestId('provider-status-added-provider')).toHaveClass(/configured/);
  await expect.poll(async () => {
    const models = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: { 'added-provider': { name?: string; apiKey?: string; models?: Array<{ contextWindow?: number; reasoning?: boolean }> } };
    };
    const auth = JSON.parse(await readFile(path.join(agentDir, 'auth.json'), 'utf8')) as {
      'added-provider'?: { key?: string };
    };
    return {
      name: models.providers['added-provider'].name,
      inlineKey: models.providers['added-provider'].apiKey,
      storedKey: auth['added-provider']?.key,
      contextWindow: models.providers['added-provider'].models?.[0]?.contextWindow,
      // 第三方模型缺省按支持推理处理，思考深度菜单可用
      reasoning: models.providers['added-provider'].models?.[0]?.reasoning,
    };
  }).toEqual({ name: 'Added Provider', inlineKey: undefined, storedKey: 'added-secret', contextWindow: 262144, reasoning: true });

  await added.locator('.provider-row-header').click();
  await expect(page.getByTestId('provider-request-url-added-provider')).toContainText(
    `http://127.0.0.1:${mockPort}/v1/responses`,
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('delete-provider-added-provider').click();
  await expect(page.getByTestId('provider-added-provider')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => {
    const models = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: Record<string, unknown>;
    };
    const auth = JSON.parse(await readFile(path.join(agentDir, 'auth.json'), 'utf8')) as Record<string, unknown>;
    return {
      hasProvider: Object.hasOwn(models.providers, 'added-provider'),
      hasCredential: Object.hasOwn(auth, 'added-provider'),
    };
  }).toEqual({ hasProvider: false, hasCredential: false });
});

test('Models 页：重新打开新增供应商表单时字段为空', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();
  const form = page.getByTestId('custom-provider-form');
  await form.getByPlaceholder('Provider name (e.g. My LLM)').fill('Temp Provider');
  await form.getByPlaceholder('baseURL').fill(`http://127.0.0.1:${mockPort}/v1`);
  await form.getByRole('button', { name: 'Cancel' }).click();

  // 再次打开：上次填写的内容不应残留
  await page.getByTestId('add-custom-provider').click();
  await expect(form.getByPlaceholder('Provider name (e.g. My LLM)')).toHaveValue('');
  await expect(form.getByPlaceholder('baseURL')).toHaveValue('');
  await expect(form.getByTestId('probe-results')).toHaveCount(0);
});

test('Models 页：已配置模型的自定义供应商仍可编辑名称与请求协议', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-mock');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.provider-row-header').click();
  await expect(page.getByTestId('provider-model-mock-mock-1')).toBeVisible();

  await page.getByTestId('edit-provider-mock').click();
  await expect(page.getByTestId('provider-edit-form-mock')).toBeVisible();
  await expect(page.getByTestId('edit-name-mock')).toHaveValue('mock');
  await page.getByTestId('edit-name-mock').fill('Renamed Mock');
  await page.getByTestId('edit-api-mock').selectOption('openai-responses');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // 列表行立即显示新名称，models.json 仅更新基本信息，模型与凭证保持不变
  await expect(row.locator('.provider-name')).toHaveText('Renamed Mock', { timeout: 15_000 });
  await expect.poll(async () => {
    const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: { mock: { name?: string; api?: string; baseUrl?: string; apiKey?: string; models?: Array<{ id: string }> } };
    };
    const p = doc.providers.mock;
    return {
      name: p.name,
      api: p.api,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      modelIds: p.models?.map((m) => m.id),
    };
  }).toEqual({
    name: 'Renamed Mock',
    api: 'openai-responses',
    baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    apiKey: 'mock-key',
    modelIds: ['mock-1', 'mock-wide'],
  });
});

test('Models 页：协议探测拒绝 200 HTML，发现 /v1 并选择真实 OpenAI 接口', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();
  const form = page.getByTestId('custom-provider-form');
  await form.getByPlaceholder('baseURL').fill(`http://127.0.0.1:${mockPort}`);
  // 列表探测：不发生成请求，4 个协议全部未验证、均可下拉选择
  await form.getByTestId('probe-custom-provider').click();
  const results = form.getByTestId('probe-results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  await expect(form.locator('.probe-result-row')).toHaveCount(4);
  await expect(form.locator('.probe-result-row').first()).toContainText('Unverified');
  await expect(form.getByTestId('custom-api-select')).toHaveValue('openai-responses');
  await expect(form.getByTestId('custom-api-select').locator('option')).toHaveText([
    'openai-responses',
    'openai-completions',
    'anthropic-messages',
    'google-generative-ai',
  ]);
  await expect(form.getByTestId('custom-request-url')).toContainText(`/v1/responses`);
  // 验证协议：发送最小化测试请求，发现 /v1 并确认 openai 两类协议可用
  await form.getByTestId('verify-protocols').click();
  await expect(results.locator('.probe-result-row').filter({ hasText: 'openai-completions' })).toContainText('Available');
  await expect(results.locator('.probe-result-row').filter({ hasText: 'openai-responses' })).toContainText('Available');
  await expect(results.locator('.probe-result-row').filter({ hasText: 'anthropic-messages' })).toContainText('Unavailable');
  await expect(form.getByTestId('custom-api-select')).toHaveValue('openai-responses');
  await expect(form.getByPlaceholder('baseURL')).toHaveValue(`http://127.0.0.1:${mockPort}/v1`);
  await expect(form.getByTestId('custom-request-url')).toContainText(`/v1/responses`);
  page.once('dialog', (dialog) => dialog.accept());
  await form.getByTestId('custom-api-select').selectOption('openai-completions');
  await expect(form.getByTestId('custom-request-url')).toContainText(`/v1/chat/completions`);
  // 上下文与最大输出自动管理：探测到的用探测值，探测不到的用前缀规格表兜底。
  await expect(form.getByTestId('probe-model-spec-mock-discovered')).toContainText('256,000');
  await expect(form.getByTestId('probe-model-spec-mock-2')).toContainText('262,144');
  await expect(form.getByTestId('probe-models')).toBeVisible();
  await expect(form.getByTestId('probe-model-mock-2')).toContainText('mock-2');
  await expect(form.getByTestId('probe-model-mock-discovered')).toContainText('mock-discovered');
  await page.screenshot({ path: 'output/playwright/models-context-unresolved.png', fullPage: false });
});

test('Models 页：探测全失败时说明不代表供应商不可用并展示错误', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();
  const form = page.getByTestId('custom-provider-form');
  await form.getByPlaceholder('baseURL').fill('http://127.0.0.1:1');
  // 列表探测：未发生成请求，协议未验证、无错误展示
  await form.getByTestId('probe-custom-provider').click();
  await expect(form.getByTestId('probe-results')).toBeVisible({ timeout: 30_000 });
  await expect(form.getByTestId('probe-rejected-hint')).toHaveCount(0);
  await expect(form.locator('.probe-result-row')).toHaveCount(4);
  await expect(form.locator('.probe-result-row').first()).toContainText('Unverified');
  // 验证协议：全部失败才出现错误与「不代表不可用」提示
  await form.getByTestId('verify-protocols').click();
  await expect(form.getByTestId('probe-rejected-hint')).toContainText(
    'does not mean the provider is unusable',
    { timeout: 30_000 },
  );
  await expect(form.locator('.probe-result-row')).toContainText([
    'Unavailable',
    'Unavailable',
    'Unavailable',
    'Unavailable',
  ]);
  await expect(form.locator('.probe-error').first()).not.toBeEmpty();
});

test('Models 页：刷新会发现已配置自定义供应商的新模型', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('refresh-models').click();
  await expect(page.getByTestId('models-refresh-message')).toContainText('Found 2 custom models', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('models-refresh-message')).toContainText(
    'Upgraded 1 provider(s) to the Responses protocol',
  );
  await expect.poll(async () => {
    const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: Record<string, { api?: string; baseUrl?: string }>;
    };
    return {
      migratedApi: doc.providers.mock.api,
      migratedBaseUrl: doc.providers.mock.baseUrl,
      noAuthApi: doc.providers.customnoauth.api,
    };
  }).toEqual({
    migratedApi: 'openai-responses',
    migratedBaseUrl: `http://127.0.0.1:${mockPort}/v1`,
    noAuthApi: 'openai-completions',
  });
  const row = page.getByTestId('provider-mock');
  await row.locator('.provider-row-header').click();
  await expect(page.getByTestId('provider-request-url-mock')).toContainText('/v1/responses');
  await expect(page.getByTestId('provider-model-mock-mock-discovered')).toBeVisible();
  // 目录上报 input: ['text','image'] → 发现链路写入 models.json 并在界面标识
  await expect(page.getByTestId('provider-model-vision-mock-mock-discovered')).toBeVisible();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
        providers: { mock: { models: Array<{ id: string; input?: string[] }> } };
      };
      return doc.providers.mock.models.find((m) => m.id === 'mock-discovered')?.input;
    }, { timeout: 15_000 })
    .toEqual(['text', 'image']);
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

test('Models 页：推理开关恢复自定义模型的思考深度', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  // 初始 mock-1 reasoning=false → 模型菜单没有思考深度入口
  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await expect(page.getByTestId('model-menu-models')).toBeVisible();
  await expect(page.getByTestId('model-menu-thinking')).toHaveCount(0);
  await selector.click();

  // Models 页：为 mock-1 打开推理开关，models.json 持久化
  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-mock');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.provider-row-header').click();
  const toggle = page.getByTestId('provider-model-reasoning-mock-mock-1').locator('input');
  await expect(toggle).not.toBeChecked();
  // 受控 checkbox：状态经 IPC 往返后异步刷新，不能用 check() 的同步断言
  await toggle.click();
  await expect(toggle).toBeChecked({ timeout: 15_000 });
  await expect
    .poll(async () => {
      const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
        providers: { mock: { models: Array<{ id: string; reasoning?: boolean }> } };
      };
      return doc.providers.mock.models.find((m) => m.id === 'mock-1')?.reasoning;
    }, { timeout: 15_000 })
    .toBe(true);

  // 回到聊天：思考深度菜单出现且档位可选（活动会话同步生效，无需重开会话）
  await page.getByTestId('nav-chat').click();
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  const thinkingRow = page.getByTestId('model-menu-thinking');
  await expect(thinkingRow).toBeVisible({ timeout: 15_000 });
  await thinkingRow.click();
  await expect(page.getByTestId('thinking-option')).toHaveCount(7);
  await page.locator('[data-testid="thinking-option"][data-value="high"]').click();

  await selector.click();
  await expect(page.getByTestId('model-menu-thinking')).toContainText('High', { timeout: 15_000 });
  await expect(page.getByTestId('model-trigger-thinking')).toContainText('High');
});

test('Models 页：图像开关声明自定义模型的多模态输入', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-mock');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.provider-row-header').click();

  // mock-1 初始 input: ['text'] → 开关关闭，无图像标识
  const toggle = page.getByTestId('provider-model-image-mock-mock-1').locator('input');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('provider-model-vision-mock-mock-1')).toHaveCount(0);

  // 受控 checkbox：状态经 IPC 往返后异步刷新
  await toggle.click();
  await expect(toggle).toBeChecked({ timeout: 15_000 });
  await expect(page.getByTestId('provider-model-vision-mock-mock-1')).toBeVisible();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
        providers: { mock: { models: Array<{ id: string; input?: string[] }> } };
      };
      return doc.providers.mock.models.find((m) => m.id === 'mock-1')?.input;
    }, { timeout: 15_000 })
    .toEqual(['text', 'image']);

  // 关闭后写回 ['text']，标识消失
  await toggle.click();
  await expect(toggle).not.toBeChecked({ timeout: 15_000 });
  await expect(page.getByTestId('provider-model-vision-mock-mock-1')).toHaveCount(0);
  await expect
    .poll(async () => {
      const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
        providers: { mock: { models: Array<{ id: string; input?: string[] }> } };
      };
      return doc.providers.mock.models.find((m) => m.id === 'mock-1')?.input;
    }, { timeout: 15_000 })
    .toEqual(['text']);
});

test('Models 页：刷新把旧版写入的多模态声明升级为规格表识别结果', async ({ launchElectronApp }) => {
  // 覆盖 beforeEach 的 models.json：模拟历史版本写入的旧模型——
  // gemini-2.5-pro 命中规格表（视觉），plain-legacy-model 未命中
  const modelsDoc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
    providers: { mock: { models: unknown[] } };
  };
  const legacyModel = (id: string) => ({
    id,
    name: id,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 4096,
  });
  modelsDoc.providers.mock.models = [legacyModel('plain-legacy-model'), legacyModel('gemini-2.5-pro')];
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify(modelsDoc));
  // mock-1 已被替换：默认模型指向仍存在的旧模型，避免启动时解析失败
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'gemini-2.5-pro' }),
  );

  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  const row = page.getByTestId('provider-mock');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.provider-row-header').click();
  // 刷新前：两个旧模型都无视觉标识
  await expect(page.getByTestId('provider-model-vision-mock-gemini-2.5-pro')).toHaveCount(0);

  await page.getByTestId('refresh-models').click();
  await expect(page.getByTestId('models-refresh-message')).toContainText('Found', {
    timeout: 30_000,
  });

  // 命中规格表的旧模型升级为多模态；未命中的保持纯文本
  await expect(page.getByTestId('provider-model-vision-mock-gemini-2.5-pro')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('provider-model-vision-mock-plain-legacy-model')).toHaveCount(0);
  await expect
    .poll(async () => {
      const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
        providers: { mock: { models: Array<{ id: string; input?: string[] }> } };
      };
      return {
        gemini: doc.providers.mock.models.find((m) => m.id === 'gemini-2.5-pro')?.input,
        plain: doc.providers.mock.models.find((m) => m.id === 'plain-legacy-model')?.input,
      };
    }, { timeout: 15_000 })
    .toEqual({ gemini: ['text', 'image'], plain: ['text'] });
});

/** Codex 风格模型菜单：触发器 → 「模型」行 → 子菜单里按 data-value 点选 */
async function selectChatModel(page: import('@playwright/test').Page, value: string) {
  await page.getByTestId('model-select').click();
  await page.getByTestId('model-menu-models').click();
  await page.locator(`[data-testid="model-option"][data-value="${value}"]`).click();
}

test('聊天页模型菜单按供应商分组与折叠展开', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();

  const modelMenu = page.getByTestId('model-menu');
  await expect(modelMenu).toBeVisible();
  // 初始无子菜单展开，无 with-submenu 修饰类
  await expect(modelMenu).not.toHaveClass(/with-submenu/);

  await page.getByTestId('model-menu-models').click();
  await expect(modelMenu).toHaveClass(/with-submenu/);
  const submenu = page.getByTestId('model-submenu');
  await expect(submenu).toBeVisible();
  // 各组模型数均 ≤5：不渲染搜索框
  await expect(submenu.getByTestId('model-search')).toHaveCount(0);

  // 当前默认模型为 mock/mock-1 -> mock 组默认展开，包含 2 个模型选项
  const mockToggle = page.locator('[data-testid="model-group-toggle"][data-value="mock"]');
  await expect(mockToggle).toBeVisible();
  await expect(mockToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(mockToggle.locator('.model-group-count')).toHaveText('2');
  const mockGroup = page.locator('.model-group', { has: page.locator('[data-testid="model-group-toggle"][data-value="mock"]') });
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(2);

  // 非当前模型组（extension-models）默认折叠，数量徽标显示 1
  const extensionToggle = page.locator('[data-testid="model-group-toggle"][data-value="extension-models"]');
  await expect(extensionToggle).toBeVisible();
  await expect(extensionToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(extensionToggle.locator('.model-group-count')).toHaveText('1');
  const extensionGroup = page.locator('.model-group', { has: page.locator('[data-testid="model-group-toggle"][data-value="extension-models"]') });
  await expect(extensionGroup.getByTestId('model-option')).toHaveCount(0);

  // 点击展开 extension-models
  await extensionToggle.click();
  await expect(extensionToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(extensionGroup.getByTestId('model-option')).toHaveText(['Extension Model 1']);

  // 再次点击折叠
  await extensionToggle.click();
  await expect(extensionToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(extensionGroup.getByTestId('model-option')).toHaveCount(0);

  // 再次展开并选中模型，验证选中后菜单关闭并在重新打开时默认展开该组
  await extensionToggle.click();
  await extensionGroup.getByTestId('model-option').click();
  await expect(modelMenu).not.toBeVisible();
  await expect(selector).toHaveAttribute('data-value', 'extension-models/extension-1');

  // 重新打开模型子菜单：此时当前模型所在组为 extension-models，默认展开；mock 变为折叠
  await selector.click();
  await page.getByTestId('model-menu-models').click();
  await expect(extensionToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(extensionGroup.getByTestId('model-option')).toHaveCount(1);
  await expect(mockToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(0);
});

test('单供应商场景：组头不渲染，列表直接平铺', async ({ launchElectronApp }) => {
  // 覆盖 settings 与 models.json，仅保留单一 mock 供应商
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
              id: 'mock-single-1',
              name: 'Mock Single 1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
            {
              id: 'mock-single-2',
              name: 'Mock Single 2',
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
  await rm(path.join(agentDir, 'extensions'), { recursive: true, force: true });
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-single-1' }),
  );

  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await page.getByTestId('model-menu-models').click();

  const submenu = page.getByTestId('model-submenu');
  await expect(submenu).toBeVisible();
  // 单供应商下不渲染折叠头
  await expect(submenu.getByTestId('model-group-toggle')).toHaveCount(0);
  // 2 个模型（≤5）：不渲染搜索框
  await expect(submenu.getByTestId('model-search')).toHaveCount(0);
  // 模型列表直接可见
  await expect(submenu.getByTestId('model-option')).toHaveCount(2);
  await expect(submenu.getByTestId('model-option')).toHaveText(['Mock Single 1', 'Mock Single 2']);
});

test('Models 页标识扩展供应商并展示 pi 模型协议与费率', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await page.getByTestId('nav-models').click();

  const row = page.getByTestId('provider-extension-models');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.locator('.provider-source')).toHaveText('Extension');
  await row.locator('.provider-row-header').click();
  await expect(page.getByTestId('provider-model-extension-models-extension-1')).toBeVisible();
  await expect(page.getByTestId('provider-model-meta-extension-models-extension-1')).toContainText('openai-completions');
  await expect(page.getByTestId('provider-model-meta-extension-models-extension-1')).toContainText('cache read $0.1');
  await expect(page.getByTestId('refresh-models')).toBeVisible();
  await page.getByTestId('provider-model-extension-models-extension-1').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/models-extension-provider.png', fullPage: false });
});

test('聊天页模型菜单：供应商模型超过 5 个时组内显示搜索并可过滤选择', async ({ launchElectronApp }) => {
  // mock 供应商 6 个模型（>5 → 组内搜索框）；扩展供应商 1 个（≤5 → 无搜索框）
  const manyModels = ['alpha-1', 'alpha-2', 'alpha-3', 'beta-1', 'beta-2', 'beta-3'].map((id) => ({
    id,
    name: `Search ${id}`,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  }));
  await writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          apiKey: 'mock-key',
          models: manyModels,
        },
      },
    }),
  );
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'alpha-1' }),
  );

  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await page.getByTestId('model-menu-models').click();
  const submenu = page.getByTestId('model-submenu');
  await expect(submenu).toBeVisible();

  // 当前模型所在 mock 组默认展开：6 个选项 + 组内搜索框
  const mockGroup = page.locator('.model-group', { has: page.locator('[data-testid="model-group-toggle"][data-value="mock"]') });
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(6);
  const search = mockGroup.getByTestId('model-search');
  await expect(search).toBeVisible();

  // 扩展供应商组（1 个模型）展开后无搜索框
  const extensionToggle = page.locator('[data-testid="model-group-toggle"][data-value="extension-models"]');
  await extensionToggle.click();
  const extensionGroup = page.locator('.model-group', { has: page.locator('[data-testid="model-group-toggle"][data-value="extension-models"]') });
  await expect(extensionGroup.getByTestId('model-option')).toHaveCount(1);
  await expect(extensionGroup.getByTestId('model-search')).toHaveCount(0);

  // 组内过滤：只影响本组，数量徽标仍显示总数
  await search.fill('beta');
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(3);
  await expect(mockGroup.locator('.model-group-count')).toHaveText('6');

  // 无匹配：组内提示
  await search.fill('zzz-no-match');
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(0);
  await expect(mockGroup.getByTestId('model-search-empty')).toBeVisible();

  // 回车选中首个命中项，菜单关闭
  await search.fill('beta-2');
  await expect(mockGroup.getByTestId('model-option')).toHaveCount(1);
  await search.press('Enter');
  await expect(page.getByTestId('model-menu')).not.toBeVisible();
  await expect(selector).toHaveAttribute('data-value', 'mock/beta-2');
});

test('聊天页模型菜单：单供应商超过 5 个模型时平铺列表也显示搜索', async ({ launchElectronApp }) => {
  const manyModels = ['flat-1', 'flat-2', 'flat-3', 'flat-4', 'flat-5', 'flat-6'].map((id) => ({
    id,
    name: `Flat ${id}`,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  }));
  await writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          apiKey: 'mock-key',
          models: manyModels,
        },
      },
    }),
  );
  await rm(path.join(agentDir, 'extensions'), { recursive: true, force: true });
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'flat-1' }),
  );

  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await page.getByTestId('model-menu-models').click();
  const submenu = page.getByTestId('model-submenu');
  await expect(submenu).toBeVisible();

  await expect(submenu.getByTestId('model-search')).toBeVisible();
  await expect(submenu.getByTestId('model-option')).toHaveCount(6);
  await submenu.getByTestId('model-search').fill('flat-5');
  await expect(submenu.getByTestId('model-option')).toHaveCount(1);
  await expect(submenu.getByTestId('model-option')).toHaveText(['Flat flat-5']);
});

test('LM Studio：自动发现模型并同步视觉能力与真实上下文', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.click();
  await page.getByTestId('model-menu-models').click();
  const submenu = page.getByTestId('model-submenu');
  const lmStudioToggle = page.locator('[data-testid="model-group-toggle"][data-value="LM Studio"]');
  await expect(lmStudioToggle).toBeVisible();
  await lmStudioToggle.click();
  const group = page.locator('.model-group', {
    has: page.locator('[data-testid="model-group-toggle"][data-value="LM Studio"]'),
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

test('Models 页：探测前隐藏协议与模型输入，探测失败后才允许手动配置', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('provider-mock')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();
  const form = page.getByTestId('custom-provider-form');
  await expect(form.getByTestId('custom-api-select')).toHaveCount(0);
  await expect(form.getByTestId('custom-models')).toHaveCount(0);

  await form.getByPlaceholder('baseURL').fill('http://127.0.0.1:1');
  await form.getByTestId('probe-custom-provider').click();
  await expect(form.getByTestId('custom-models')).toBeVisible({ timeout: 30_000 });
  await expect(form.getByTestId('custom-api-select').locator('option')).toHaveText([
    'openai-responses',
    'openai-completions',
    'anthropic-messages',
    'google-generative-ai',
  ]);
  // 列表探测不判定协议，无「被拒绝」提示；验证全失败后才出现
  await expect(form.getByTestId('probe-rejected-hint')).toHaveCount(0);
  await form.getByTestId('verify-protocols').click();
  await expect(form.getByTestId('probe-rejected-hint')).toBeVisible({ timeout: 30_000 });
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

  const usageButton = page.getByTestId('token-usage');
  await expect(usageButton).not.toContainText('—');
  await expect(usageButton).toContainText('0%');
  await usageButton.click();
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

test('思考深度档位：逐模型可用档支持 xhigh/max 且在模型切换时正确刷新与 clamp', async ({
  launchElectronApp,
}) => {
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
              id: 'mock-custom-thinking',
              name: 'Mock Custom Thinking',
              reasoning: true,
              thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
            {
              id: 'mock-default-thinking',
              name: 'Mock Default Thinking',
              reasoning: true,
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
  await rm(path.join(agentDir, 'extensions'), { recursive: true, force: true });
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-custom-thinking' }),
  );

  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  const selector = page.getByTestId('model-select');
  await expect(selector).toBeVisible({ timeout: 30_000 });

  // 1. mock-custom-thinking 声明 off: null, xhigh: 'xhigh', max: 'max'
  // 思考菜单应出现 6 档（无 "关闭" / off），含 "Very high" / "Maximum"
  await selector.click();
  const thinkingRow = page.getByTestId('model-menu-thinking');
  await expect(thinkingRow).toBeVisible({ timeout: 15_000 });
  await thinkingRow.click();
  const options = page.getByTestId('thinking-option');
  await expect(options).toHaveCount(6);
  await expect(page.locator('[data-testid="thinking-option"][data-value="off"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="thinking-option"][data-value="xhigh"]')).toBeVisible();
  await expect(page.locator('[data-testid="thinking-option"][data-value="max"]')).toBeVisible();

  // 2. 选择 max 档位，trigger 与 menu 同步显示 Maximum
  await page.locator('[data-testid="thinking-option"][data-value="max"]').click();
  await selector.click();
  await expect(page.getByTestId('model-menu-thinking')).toContainText('Maximum', { timeout: 15_000 });
  await expect(page.getByTestId('model-trigger-thinking')).toContainText('Maximum');

  // 3. 切换为 mock-default-thinking（不带 map 的 reasoning 模型）
  // 菜单应刷新为 5 档（off–high），且 pi 将超出范围的 max 自动 clamp 到 high
  await page.getByTestId('model-menu-models').click();
  await page.locator('[data-testid="model-option"][data-value="mock/mock-default-thinking"]').click();

  // 验证 trigger 文案被 clamp 为 High
  await expect(page.getByTestId('model-trigger-thinking')).toContainText('High', { timeout: 15_000 });

  // 打开思考菜单，确认显示 5 档（包含 off，不含 xhigh/max）
  await selector.click();
  await expect(page.getByTestId('model-menu-thinking')).toContainText('High');
  await page.getByTestId('model-menu-thinking').click();
  await expect(page.getByTestId('thinking-option')).toHaveCount(5);
  await expect(page.locator('[data-testid="thinking-option"][data-value="off"]')).toBeVisible();
  await expect(page.locator('[data-testid="thinking-option"][data-value="xhigh"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="thinking-option"][data-value="max"]')).toHaveCount(0);
});

