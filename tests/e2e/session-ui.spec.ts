// 会话标题 / 侧栏 / 顶部 chrome 横线 / git 分支 chip 的 E2E。
// 覆盖：
//   - 顶部左侧按钮文案「新建会话」（zh）
//   - 未发送任何内容：标题区不显示「未命名会话」，侧栏不出现空会话
//   - 发消息后：标题自动命名出现，侧栏才出现该会话
//   - 顶部标题栏与会话名下方均无横线
//   - 输入栏 git 分支 chip：git 仓库显示分支、非仓库不显示、切换工作区/checkout 后更新
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let workspace: string;
let agentDir: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock timeout')), 10_000);
  });
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-ui-agent-'));
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
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }));
});

test.afterAll(async () => {
  mock?.kill();
  await rm(agentDir, { recursive: true, force: true });
});

/** 造 git 仓库（.git/HEAD 直接写 ref，无需真实 git）。 */
async function makeGitRepo(root: string, branch: string): Promise<string> {
  const repo = await mkdtemp(path.join(root, 'repo-'));
  await mkdir(path.join(repo, '.git', 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(repo, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  return repo;
}

async function switchZh(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('lang-zh')).toBeVisible();
  await page.getByTestId('lang-zh').click();
  await expect(page.getByTestId('nav-chat')).toHaveText('对话');
  await page.getByTestId('nav-chat').click();
}

test('顶部左侧按钮为「新建会话」；未发送内容时无「未命名会话」且侧栏无空会话', async ({ launchElectronApp }) => {
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-ui-workspace-'));
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();

  await switchZh(page);

  // 按钮文案 = 新建会话
  await expect(page.getByTestId('new-chat')).toContainText('新建会话');

  // 会话启动后、发送任何内容前：标题区为空占位，没有「未命名会话」，也没有可重命名的标题按钮
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('session-title-empty')).toBeVisible();
  await expect(page.getByTestId('session-title-button')).toHaveCount(0);
  await expect(page.getByTestId('session-titlebar')).not.toContainText('未命名会话');

  // 侧栏不出现空会话，也不含「未命名会话」文案
  await expect(page.getByTestId('sidebar-sessions')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sidebar-sessions')).not.toContainText('未命名会话');
  await expect(page.getByTestId('sidebar-sessions').locator('.sidebar-session-row')).toHaveCount(0);

  await rm(workspace, { recursive: true, force: true });
});

test('发送内容后标题自动命名出现，侧栏才出现该会话', async ({ launchElectronApp }) => {
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-ui-workspace-'));
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('chat-input').fill('帮我看看这个项目结构');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  // 标题按钮出现，内容是首问生成的标题（不再是空的「未命名会话」占位）
  await expect(page.getByTestId('session-title-button')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('session-title-button')).toContainText('帮我看看这个项目结构');
  await expect(page.getByTestId('session-title-empty')).toHaveCount(0);

  // 侧栏出现该会话（firstMessage 匹配）
  await expect(page.getByTestId('sidebar-sessions')).toContainText('帮我看看这个项目结构', { timeout: 15_000 });
  await expect(page.getByTestId('sidebar-sessions')).not.toContainText('未命名会话');

  await rm(workspace, { recursive: true, force: true });
});

test('顶部标题栏与会话名下方均无横线', async ({ launchElectronApp }) => {
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-ui-workspace-'));
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('chat-input').fill('Say PONG');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

  // Windows/Linux 自绘标题栏：无 border-bottom；macOS 无自绘层（跳过）
  if (process.platform !== 'darwin') {
    await expect(page.getByTestId('titlebar')).toHaveCSS('border-bottom-style', 'none');
    await expect(page.getByTestId('titlebar')).toHaveCSS('border-bottom-width', '0px');
  }
  // 会话标题栏：无 border-bottom
  await expect(page.getByTestId('session-titlebar')).toHaveCSS('border-bottom-style', 'none');
  await expect(page.getByTestId('session-titlebar')).toHaveCSS('border-bottom-width', '0px');

  await rm(workspace, { recursive: true, force: true });
});

test('git 分支 chip：仓库显示分支、checkout 换分支 / detached 后自动更新', async ({ launchElectronApp }) => {
  const gitWorkspace = await makeGitRepo(tmpdir(), 'win-compat');

  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: gitWorkspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  // git 仓库：chip 显示分支
  const chip = page.getByTestId('git-branch');
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await expect(chip).toContainText('win-compat');

  // checkout 换分支：直接改 HEAD 文件，等待轮询（5s）刷新
  await writeFile(path.join(gitWorkspace, '.git', 'HEAD'), 'ref: refs/heads/release/v2\n');
  await expect(page.getByTestId('git-branch')).toContainText('release/v2', { timeout: 12_000 });

  // detached HEAD
  await writeFile(path.join(gitWorkspace, '.git', 'HEAD'), '8f5c2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f\n');
  await expect(page.getByTestId('git-branch')).toContainText('detached', { timeout: 12_000 });

  await rm(gitWorkspace, { recursive: true, force: true });
});

test('git 分支切换：新会话状态下可切换分支，发送消息后变只读', async ({ launchElectronApp }) => {
  const gitWorkspace = await mkdtemp(path.join(tmpdir(), 'pi-e2e-git-switch-'));
  const { execSync } = await import('node:child_process');
  execSync('git init -b main', { cwd: gitWorkspace });
  execSync('git config user.name "Test"', { cwd: gitWorkspace });
  execSync('git config user.email "test@test.com"', { cwd: gitWorkspace });
  await writeFile(path.join(gitWorkspace, 'init.txt'), 'init');
  execSync('git add init.txt && git commit -m "init"', { cwd: gitWorkspace });
  execSync('git branch feature-a', { cwd: gitWorkspace });

  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: gitWorkspace },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });

    const chip = page.getByTestId('git-branch');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toContainText('main');
    await expect(chip).toHaveClass(/switchable/);

    // 点击 chip 弹出分支菜单
    await chip.click();
    const menu = page.getByTestId('git-branch-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="git-branch-option"]')).toHaveCount(2);

    // 点击 feature-a 切换
    await menu.locator('[data-testid="git-branch-option"][data-value="feature-a"]').click();
    await expect(chip).toContainText('feature-a');

    // 发送消息后，chip 变为只读 disabled
    await page.getByTestId('chat-input').fill('Say PONG test branch lock');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });

    await expect(page.getByTestId('git-branch')).toHaveClass(/disabled/);
  } finally {
    await rm(gitWorkspace, { recursive: true, force: true });
  }
});
