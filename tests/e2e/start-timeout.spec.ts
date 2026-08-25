// 会话启动超时场景 E2E（真 pi + mock provider，不烧 API quota）。
// 覆盖用户反馈的「会话启动超时，请检查后重试 → 面板卡死无法操作、重试无效」：
//   1. 启动超时 → banner 在聊天列内（不挤压布局）、composer 仍可输入（面板未卡死）
//   2. 超时后底层构建继续：完成后点击重试 → 复用后台构建，会话恢复
// 慢启动注入：agentDir/extensions 放一个顶层 await 延迟的扩展（pi 在 createAgentSession
// 的 resourceLoader 阶段加载扩展，会阻塞 runtime 构建直到延迟结束）。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

/** 扩展加载延迟：大于超时（4s）小于重试窗口，保证首启必超时、后台构建能完成 */
const EXTENSION_DELAY_MS = 8000;
/** 主进程会话启动超时（经 fixture 的 PI_DESKTOP_START_TIMEOUT_MS 注入） */
const START_TIMEOUT_MS = 4000;

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
          models: [{
            id: 'mock-1',
            name: 'Mock 1',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          }],
        },
      },
    }),
  );
  await mkdir(path.join(agentDir, 'extensions'), { recursive: true });
  // 顶层 await 阻塞扩展模块求值 → 阻塞 pi 的 resourceLoader → 阻塞 runtime 构建
  await writeFile(
    path.join(agentDir, 'extensions', 'slow-start.ts'),
    [
      `await new Promise((resolve) => setTimeout(resolve, ${EXTENSION_DELAY_MS}));`,
      'export default function () {};',
      '',
    ].join('\n'),
  );
});

test.afterAll(async () => {
  mock?.kill();
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

test('启动超时 → banner 不卡死面板，后台构建完成后重试即恢复', async ({ launchElectronApp }) => {
  const startedAt = Date.now();
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
    startTimeoutMs: START_TIMEOUT_MS,
  });
  const page = await app.firstWindow();

  // 超时（4s）后出现启动超时 banner（locale en：Session start timed out）
  const banner = page.locator('.error-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText('Session start timed out');
  // 超时发生在扩展延迟（8s）结束前，证明慢构建确实超过了超时阈值
  expect(Date.now() - startedAt).toBeLessThan(EXTENSION_DELAY_MS + 2000);

  // 面板未卡死：composer 可输入、重试按钮可用、布局未被挤压
  const input = page.getByTestId('chat-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill('still interactive');
  const retry = page.getByTestId('start-retry');
  await expect(retry).toBeVisible();
  const inputBox = await input.boundingBox();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  expect(inputBox!.width).toBeGreaterThan(viewport.width * 0.3);

  // 等后台构建完成（扩展延迟结束），点击重试 → 复用后台构建，会话就绪
  await page.waitForTimeout(Math.max(0, EXTENSION_DELAY_MS - (Date.now() - startedAt)) + 1000);
  await retry.click();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  // 会话完全恢复：发消息有回复
  await input.fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await app.close();
});
