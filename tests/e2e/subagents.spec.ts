import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;

const SUBAGENT_EXTENSION_SOURCE = `export default function (pi: any) {
  pi.registerTool({
    name: 'subagent',
    label: 'Subagent Worker',
    description: 'Dispatch a background subagent task',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        task: { type: 'string' },
      },
    },
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any) => {
      onUpdate?.({ content: [{ type: 'text', text: 'Scanning repository files 50%...' }] });
      await new Promise((r) => setTimeout(r, 600));
      return {
        content: [{ type: 'text', text: 'Subagent indexing completed: found 42 files.' }],
      };
    },
  });

  pi.registerTool({
    name: 'subagent_slow',
    label: 'Slow Subagent Worker',
    description: 'Long running subagent task for abort verification',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        task: { type: 'string' },
      },
    },
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any) => {
      onUpdate?.({ content: [{ type: 'text', text: 'Crawling documentation pages...' }] });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ content: [{ type: 'text', text: 'Crawling done' }] });
        }, 15000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Subagent was aborted'));
        }, { once: true });
      });
    },
  });
}
`;

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

  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-subagent-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-subagent-workspace-'));
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

  // 注册测试扩展中的 subagent 工具
  const extDir = path.join(agentDir, 'extensions', 'e2e-subagent');
  await mkdir(extDir, { recursive: true });
  await writeFile(path.join(extDir, 'index.ts'), SUBAGENT_EXTENSION_SOURCE);
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

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

test('Subagent 工具调用：ToolCallCard 兜底展示、工作台面板实时进度与中断安全', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 先打开右侧工作台，确保可以观测到实时流式与任务状态
  await page.getByTestId('workspace-toggle').click();
  const subagentsTabBtn = page.getByTestId('workspace-subagents-tab');
  await expect(subagentsTabBtn).toBeVisible({ timeout: 10_000 });
  await subagentsTabBtn.click();

  // 初始状态下工作台展示无任务空状态
  const subagentPanel = page.getByTestId('workbench-subagents-panel');
  await expect(subagentPanel).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('subagent-empty-state')).toBeVisible();

  // 发送触发 subagent 工具的指令
  const input = page.getByTestId('chat-input');
  await input.fill('USE_TOOL_SUBAGENT');
  await page.getByTestId('chat-send').click();

  // 断言聊天流中出现工具卡
  const toolCard = page.getByTestId('tool-card').first();
  await expect(toolCard).toBeVisible({ timeout: 15_000 });

  // 展开工具卡查看参数
  const parameters = page.getByTestId('tool-parameters').first();
  await expect(parameters).toBeVisible({ timeout: 10_000 });
  await expect(parameters).toContainText('researcher');

  // 断言工作台子任务面板出现该任务条目
  const subagentList = page.getByTestId('subagent-list');
  await expect(subagentList).toBeVisible();
  await expect(subagentList).toContainText('subagent');
  await expect(subagentList).toContainText('researcher');

  // 等待回合完成（发送按钮恢复可用）
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 20_000 });

  // 任务结束后断言状态变为 success 且结果可见
  const successBadge = page.getByTestId('subagent-status-success').first();
  await expect(successBadge).toBeVisible({ timeout: 10_000 });

  // 展开已完成的条目查看最终输出
  await page.getByTestId('subagent-item-header').first().click();
  const output = page.getByTestId('subagent-output').first();
  await expect(output).toBeVisible();
  await expect(output).toContainText('Subagent indexing completed: found 42 files.');

  // 断言主窗口消息流底部渲染专属的回合子任务聚合卡片（图 3 红框位置）
  const turnSubagents = page.getByTestId('turn-subagents-card').first();
  await expect(turnSubagents).toBeVisible();
  await expect(turnSubagents).toContainText('Agent - researcher');
  await expect(page.getByTestId('turn-subagents-open-workbench').first()).toBeVisible();
});

test('Subagent 工具调用中断：回合级中止时子任务被标记为 interrupted 且单工具中断按钮禁用', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 打开右侧工作台子任务面板
  await page.getByTestId('workspace-toggle').click();
  const subagentsTabBtn = page.getByTestId('workspace-subagents-tab');
  await subagentsTabBtn.click();

  // 触发一个慢速 subagent 任务
  const input = page.getByTestId('chat-input');
  await input.fill('USE_TOOL_SUBAGENT_SLOW');
  await page.getByTestId('chat-send').click();

  // 等待停止按钮出现，断言停止按钮在运行中可用
  const stopBtn = page.getByTestId('chat-stop');
  await expect(stopBtn).toBeVisible({ timeout: 10_000 });

  // 在工作台面板中看到运行中的任务条目与流式文本
  const subagentItem = page.getByTestId('subagent-list').locator('.subagent-item').first();
  await expect(subagentItem).toBeVisible({ timeout: 10_000 });

  // 单工具中断按钮为禁用态，且具有说明性 tooltip（单工具中断受限于 pi 引擎）
  const toolStopBtn = page.getByTestId('subagent-stop-btn').first();
  await expect(toolStopBtn).toBeVisible();
  await expect(toolStopBtn).toBeDisabled();
  await expect(toolStopBtn).toHaveAttribute('title', /单工具|single-tool/i);

  // 点击回合级中断按钮
  await stopBtn.click();

  // 断言子任务状态立刻变为 interrupted
  const interruptedBadge = page.getByTestId('subagent-status-interrupted').first();
  await expect(interruptedBadge).toBeVisible({ timeout: 10_000 });
});

test('当模型建议使用子 Agent 时，渲染安装引导条并在未安装时支持一键操作', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const input = page.getByTestId('chat-input');
  await input.fill('SUGGEST_SUBAGENT');
  await page.getByTestId('chat-send').click();

  // 等待回合结束
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 20_000 });

  // 断言 subagent-install-hint 提示条可见
  const hint = page.getByTestId('subagent-install-hint');
  await expect(hint).toBeVisible({ timeout: 10_000 });
  await expect(hint).toContainText(/pi-subagents/);

  // 包含一键安装按钮与前往扩展管理按钮
  const installBtn = page.getByTestId('subagent-hint-install');
  await expect(installBtn).toBeVisible();
  const manageBtn = page.getByTestId('subagent-hint-manage');
  await expect(manageBtn).toBeVisible();
});

test('工作台拓展在切换到设置页面时自动缩回，并在切回对话页面时自动恢复拓宽', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 1. 记录初始常规窗口尺寸
  const initialWidth = await page.evaluate(() => window.outerWidth);

  // 2. 展开工作台（docked 模式触发展开拓宽）
  await page.getByTestId('workspace-toggle').click();
  await expect(page.getByTestId('workspace-subagents-tab')).toBeVisible({ timeout: 10_000 });

  // 等待加宽完成
  await expect.poll(async () => {
    return page.evaluate(() => window.outerWidth);
  }, { timeout: 5000 }).toBeGreaterThan(initialWidth);
  const expandedWidth = await page.evaluate(() => window.outerWidth);

  // 3. 点击左侧导航栏的「设置」切离 Chat
  await page.getByTestId('nav-settings').click();
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10_000 });

  // 4. 断言窗口自动缩回为初始常规尺寸
  await expect.poll(async () => {
    return page.evaluate(() => window.outerWidth);
  }, { timeout: 5000 }).toBe(initialWidth);

  // 5. 点击左侧导航栏的「对话」切回 Chat
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10_000 });

  // 6. 断言窗口自动恢复为加宽后的尺寸，且工作台保持打开
  await expect.poll(async () => {
    return page.evaluate(() => window.outerWidth);
  }, { timeout: 5000 }).toBe(expandedWidth);
  await expect(page.getByTestId('workspace-subagents-tab')).toBeVisible();
});



