// 自定义供应商 + vLLM：探测识别 vLLM（/version 端点），写库时按服务器类型
// 决定思考控制兼容配置（chat-template + chat_template_kwargs.enable_thinking），
// 与 LM Studio 的 reasoning_effort 方案互不混淆。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';
import { seedTrustedWorkspace } from '../helpers/trust';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-vllm-server.mjs'),
  ]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_VLLM_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock vllm timeout')), 10_000);
  });
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-vllm-workspace-'));
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-vllm-agent-'));
  await seedTrustedWorkspace(agentDir, workspace);
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
});

const launchOptions = () => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace },
});

test('vLLM：探测识别服务器类型，写库走 chat-template 思考控制 + 本地占位 key', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('add-custom-provider')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-custom-provider').click();
  const form = page.getByTestId('custom-provider-form');
  await form.getByPlaceholder('Provider id (e.g. my-llm)').fill('friend-vllm');
  await form.getByPlaceholder('baseURL').fill(`http://127.0.0.1:${mockPort}`);
  await form.getByTestId('probe-custom-provider').click();

  // 服务端 supported_endpoint_types=chat → 推荐 openai-completions
  await expect(form.getByTestId('custom-api-select')).toHaveValue('openai-completions', { timeout: 30_000 });
  await expect(form.getByTestId('probe-models')).toContainText('qwen/qwen3.8-27b');

  await expect(form.getByRole('button', { name: 'Save provider' })).toBeEnabled();
  await form.getByRole('button', { name: 'Save provider' }).click();
  await expect(page.getByTestId('provider-friend-vllm')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('provider-status-friend-vllm')).toHaveClass(/configured/);

  await expect.poll(async () => {
    const doc = JSON.parse(await readFile(path.join(agentDir, 'models.json'), 'utf8')) as {
      providers: {
        'friend-vllm': {
          apiKey?: string;
          compat?: Record<string, unknown>;
          models?: Array<{ id: string; reasoning?: boolean; thinkingLevelMap?: unknown }>;
        };
      };
    };
    const p = doc.providers['friend-vllm'];
    return {
      apiKey: p.apiKey,
      compat: p.compat,
      modelId: p.models?.[0]?.id,
      reasoning: p.models?.[0]?.reasoning,
      thinkingLevelMap: p.models?.[0]?.thinkingLevelMap,
    };
  }).toEqual({
    apiKey: 'local',
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      thinkingFormat: 'chat-template',
      chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' } },
    },
    modelId: 'qwen/qwen3.8-27b',
    reasoning: true,
    thinkingLevelMap: undefined,
  });
  await app.close();
});
