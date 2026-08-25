// 供应商失效场景 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖用户报告的「供应商没了打开旧会话大报错、什么都用不了、重试无效」：
// pi SDK 对缺失供应商的行为是静默回退/无模型启动（不抛错），因此场景按真实行为断言：
//   1. 删掉供应商（仍有其他可用）→ 旧会话静默回退可用模型，历史完好、可继续对话
//   2. 改错 apiKey → 旧会话正常打开，发消息 401 行内提示、不打断会话
//   3. 供应商全删（无可用模型）→ 旧会话仍可打开，发消息为可关闭的行内提示，
//      不出现挤压布局的整列大 banner（修复前该路径写 startError 触发大 banner）
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type LaunchOptions } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let workspace: string;
// 每用例独立 agentDir：会话与 models.json 互不污染（上例恢复过的会话模型已变，
// 共享目录会让后续用例点错旧会话）。
const agentDirs: string[] = [];

/** 写 models.json：mockApiKey 控制 mock provider 的 apiKey；withMock/withRescue 控制删除模拟 */
async function writeModels(agentDir: string, options: { mockApiKey?: string; withMock?: boolean; withRescue?: boolean } = {}) {
  const { mockApiKey = 'mock-key', withMock = true, withRescue = true } = options;
  // mock 必须排在首位：新会话默认取第一个 provider 的模型，
  // 阶段一创建的会话要绑定 mock/mock-1（后续删 mock 才构成失效场景）。
  const providers: Record<string, unknown> = {};
  if (withMock) {
    providers.mock = {
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      api: 'openai-completions',
      apiKey: mockApiKey,
      models: [{
        id: 'mock-1',
        name: 'Mock 1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      }],
    };
  }
  if (withRescue) {
    providers.rescue = {
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      api: 'openai-completions',
      apiKey: 'mock-key',
      models: [{
        id: 'rescue-1',
        name: 'Rescue 1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      }],
    };
  }
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers }));
}

/** 独立 agentDir + 默认 models.json + 关自动重试 */
async function setupAgentDir(): Promise<string> {
  const agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  agentDirs.push(agentDir);
  await writeModels(agentDir);
  // 关闭自动重试：错误必须直接浮出，不被 pi 吞掉重试。
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ retry: { enabled: false } }),
  );
  return agentDir;
}

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
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
  for (const dir of agentDirs) await rm(dir, { recursive: true, force: true });
});

/** 等会话启动（模型选择器/徽标出现 = runtime 就绪） */
async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 发一轮消息并等回复（让会话落盘、产生 assistant 消息） */
async function sendOneRound(page: import('@playwright/test').Page) {
  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

/** 布局断言：错误提示出现时输入区仍占聊天列主体宽度（挤压布局修复前会被挤成窄条） */
async function expectLayoutIntact(page: import('@playwright/test').Page) {
  const inputBox = await page.getByTestId('chat-input').boundingBox();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  expect(inputBox).not.toBeNull();
  expect(inputBox!.width).toBeGreaterThan(viewport.width * 0.3);
}

const launchOptions = (agentDir: string): LaunchOptions => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace },
});

/** 阶段一：正常创建一个会话（标题 "Say PONG"），返回后 app 已关闭 */
async function createSessionThenClose(
  launchElectronApp: (options?: LaunchOptions) => Promise<import('@playwright/test').ElectronApplication>,
  agentDir: string,
) {
  const app = await launchElectronApp(launchOptions(agentDir));
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await sendOneRound(page);
  await app.close();
}

/** 打开侧栏里的旧会话（按标题过滤） */
async function openOldSession(page: import('@playwright/test').Page) {
  await page.locator('.sidebar-session').filter({ hasText: 'Say PONG' }).first().click();
}

test('删除供应商（仍有可用模型）→ 旧会话静默回退，历史完好可继续对话', async ({ launchElectronApp }) => {
  const agentDir = await setupAgentDir();
  await createSessionThenClose(launchElectronApp, agentDir);
  // 模拟用户删掉 mock 供应商（只剩 rescue）
  await writeModels(agentDir, { withMock: false });

  const app = await launchElectronApp(launchOptions(agentDir));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await openOldSession(page);

  // pi 静默回退到可用模型：无任何错误，历史完好
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expectLayoutIntact(page);

  // 回退后的会话完全可用：发消息仍有回复
  await sendOneRound(page);
  await app.close();
});

test('改错 apiKey → 旧会话正常打开，发消息报 401 行内提示、不打断会话', async ({ launchElectronApp }) => {
  const agentDir = await setupAgentDir();
  await createSessionThenClose(launchElectronApp, agentDir);
  // 模拟用户把 apiKey 改错（mock server 对 wrong-key 返回 401）
  await writeModels(agentDir, { mockApiKey: 'wrong-key' });

  const app = await launchElectronApp(launchOptions(agentDir));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 旧会话能打开：历史消息可见、无启动错误 banner
  await openOldSession(page);
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // 发消息 → 401 → 消息流内错误提示（含归属 hint），不触发大 banner、布局完好
  await page.getByTestId('chat-input').fill('Say PONG again');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-error').last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-error').last()).toContainText('Invalid token');
  await expect(page.getByTestId('error-hint-invalid-key')).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expectLayoutIntact(page);
  // 历史消息仍在，输入区可用（会话未被错误打断）
  await expect(page.getByTestId('message-assistant').first()).toContainText('PONG');
  await expect(page.getByTestId('chat-input')).toBeEnabled();
  await app.close();
});

test('供应商全删（无可用模型）→ 旧会话仍可打开，发消息为可关闭的行内提示而非大 banner', async ({ launchElectronApp }) => {
  const agentDir = await setupAgentDir();
  await createSessionThenClose(launchElectronApp, agentDir);
  // 模拟用户唯一供应商被删：models.json 无任何 provider
  await writeModels(agentDir, { withMock: false, withRescue: false });

  const app = await launchElectronApp(launchOptions(agentDir));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 旧会话仍能打开：历史可见、无启动错误（pi 无模型也允许恢复会话）
  await openOldSession(page);
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // 发消息 → 行内可关闭提示（pi 原始文案），不出现挤压布局的整列大 banner
  await page.getByTestId('chat-input').fill('Say PONG again');
  await page.getByTestId('chat-send').click();
  const notice = page.getByTestId('runtime-error-notice');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText(/No API key|No models/i);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expectLayoutIntact(page);

  // 提示可关闭，关闭后历史仍在、输入区可用
  await page.getByTestId('runtime-error-dismiss').click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG');
  await expect(page.getByTestId('chat-input')).toBeEnabled();
  await app.close();
});
