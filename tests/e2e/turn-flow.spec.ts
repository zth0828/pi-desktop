// 消息流核心交互 E2E（Codex 对齐批次 1，真 pi + mock provider，不烧 API quota）：
// 1) 聚合编辑卡：一轮 edit+write → 「Edited N files +x -y」卡 → 撤销（git）→ 磁盘复原；
//    非 git 目录保留清单但无撤销入口；「Review」按钮打开 Review 面板。
// 2) 完成轮的 thinking/阶段文本/工具统一收进回合折叠，最终答复保持可见。
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
/** git 仓库 workspace（撤销路径） */
let repoWorkspace: string;
/** 非 git workspace（降级：无撤销按钮） */
let plainWorkspace: string;
/** 工作日志折叠专用 workspace（避免与其他用例的文件状态互相污染） */
let foldWorkspace: string;

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString();

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
  repoWorkspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-repo-'));
  plainWorkspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-plain-'));
  foldWorkspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-fold-'));

  // edit 工具目标文件（mock 会把 alpha → beta）；git 仓库含一个初始 commit
  await writeFile(path.join(repoWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
  git(repoWorkspace, ['init']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

  await writeFile(path.join(plainWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
  await writeFile(path.join(foldWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');

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
});

test.afterAll(async () => {
  mock?.kill();
  await rm(agentDir, { recursive: true, force: true });
  await rm(repoWorkspace, { recursive: true, force: true });
  await rm(plainWorkspace, { recursive: true, force: true });
  await rm(foldWorkspace, { recursive: true, force: true });
});

const launchOptions = (workspace: string) => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace },
});

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function sendPrompt(page: import('@playwright/test').Page, prompt: string) {
  await page.getByTestId('chat-input').fill(prompt);
  await page.getByTestId('chat-send').click();
}

/** 等当前轮所有工具卡完成 */
async function waitToolsDone(page: import('@playwright/test').Page, count: number) {
  const summary = page.getByTestId('turn-fold-toggle').last();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await summary.click();
  await expect(page.getByTestId('tool-card')).toHaveCount(count, { timeout: 30_000 });
  for (const card of await page.getByTestId('tool-card').all()) {
    await expect(card.locator('.tool-status')).toHaveText('done', { timeout: 30_000 });
  }
}

test('一轮 edit+write → 聚合编辑卡（清单 + 增删统计）→ 撤销后磁盘复原', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendPrompt(page, 'USE_TOOL_EDIT_WRITE now');
  await waitToolsDone(page, 2);

  const foldSize = await page.getByTestId('turn-fold').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(foldSize.scrollHeight).toBe(foldSize.clientHeight);

  const card = page.getByTestId('turn-changes');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('turn-changes-title')).toHaveText('Edited 2 files');

  // 文件清单：edit +1/-1，write 新建 +1/-0
  const editRow = card.getByTestId('turn-changes-file').filter({ hasText: 'e2e-edit-target.txt' });
  await expect(editRow).toBeVisible();
  await expect(editRow.locator('.turn-stat-add')).toHaveText('+1');
  await expect(editRow.locator('.turn-stat-del')).toHaveText('-1');
  const writeRow = card.getByTestId('turn-changes-file').filter({ hasText: 'e2e-new-file.txt' });
  await expect(writeRow).toBeVisible();
  await expect(writeRow.locator('.turn-stat-add')).toHaveText('+1');
  await expect(writeRow.locator('.turn-stat-del')).toHaveText('-0');

  // git 仓库：撤销按钮出现，批量 revertFile 后磁盘复原
  await card.getByTestId('turn-changes-revert').click();
  await expect(card.getByTestId('turn-changes-reverted')).toBeVisible({ timeout: 30_000 });
  expect(await readFile(path.join(repoWorkspace, 'e2e-edit-target.txt'), 'utf-8')).toBe(
    'alpha\ngamma\n',
  );
  expect(existsSync(path.join(repoWorkspace, 'e2e-new-file.txt'))).toBe(false);
});

test('非 Git 目录：聚合编辑卡可回滚，Review 按钮打开完整评审面板', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions(plainWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendPrompt(page, 'USE_TOOL_EDIT_WRITE now');
  await waitToolsDone(page, 2);

  const card = page.getByTestId('turn-changes');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('turn-changes-file')).toHaveCount(2);
  await expect(card.getByTestId('turn-changes-revert')).toBeVisible();

  await card.getByTestId('turn-changes-review').click();
  await expect(page.getByTestId('review-panel')).toBeVisible();
  await expect(page.getByTestId('review-fallback')).toHaveCount(0);
  await expect(page.getByTestId('review-file')).toHaveCount(2);
});

test('完成回合整体折叠过程内容，展开恢复阶段文本与工具，最终答复始终可见', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions(foldWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 第一轮完成后立即收起：过程文本与工具卡都不在可见树中。
  await sendPrompt(page, 'USE_TOOL_EDIT now');
  await expect(page.getByTestId('turn-fold-toggle')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'PROCESS:' })).toHaveCount(0);

  // 第二轮完成后也独立聚合，页面不会随执行次数持续铺开。
  await sendPrompt(page, 'USE_TOOL_WRITE now');
  // 等第二轮真正结束（两轮的聚合编辑卡都挂上 = 两轮 run.ended 都已处理）
  await expect(page.getByTestId('turn-changes')).toHaveCount(2, { timeout: 30_000 });
  const rows = page.getByTestId('turn-fold-toggle');
  await expect(rows).toHaveCount(2);
  await expect(rows.last()).toContainText(/Show turn process|展开本轮过程/);
  await expect(page.getByTestId('tool-card')).toHaveCount(0);

  // user 消息原位（rail 锚点与 messages 下标对齐），最终文本仍完整显示；
  // 每轮最终答复保持可见，阶段文本默认不渲染。
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(page.locator('#chat-msg-0')).toContainText('USE_TOOL_EDIT');
  await expect(
    page.getByTestId('message-user').filter({ hasText: 'USE_TOOL_WRITE' }),
  ).toHaveAttribute('id', /^chat-msg-\d+$/);
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'FINAL:' })).toHaveCount(2);
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'PROCESS:' })).toHaveCount(0);
  await page.screenshot({ path: 'output/playwright/turn-fold-collapsed.png', fullPage: false });

  // 点击展开：该轮阶段文本和工具卡同时还原，其他轮仍收起。
  await rows.first().click();
  await expect(page.getByTestId('tool-card')).toHaveCount(1);
  await expect(page.getByTestId('turn-fold-toggle')).toHaveCount(2);
  const expandedRow = page.locator('[data-testid="turn-fold-toggle"][aria-expanded="true"]');
  await expect(expandedRow).toHaveCount(1);
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'PROCESS:' })).toHaveCount(1);
  await page.screenshot({ path: 'output/playwright/turn-fold-expanded.png', fullPage: false });

  // 再点同一行收起：回到全聚合状态
  await expandedRow.click();
  await expect(page.getByTestId('tool-card')).toHaveCount(0);
  await expect(page.getByTestId('turn-fold-toggle')).toHaveCount(2);
  await expect(page.locator('[data-testid="turn-fold-toggle"][aria-expanded="true"]')).toHaveCount(0);
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'PROCESS:' })).toHaveCount(0);
});

test('thinking 与最终文本在同一消息时，折叠只保留最终答复', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions(foldWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendPrompt(page, 'REASONING_TURN');
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'FINAL: reasoning complete' })).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByTestId('turn-fold-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.thinking-block')).toHaveCount(0);

  await toggle.click();
  await expect(page.locator('.thinking-block pre')).toContainText('THOUGHT: inspect the request');
  await expect(page.locator('.thinking-block')).toHaveAttribute('open', '');
  await expect(page.getByTestId('message-assistant').filter({ hasText: 'FINAL: reasoning complete' })).toBeVisible();

  // 完全退出并重启后，pi session 历史里的 thinking 仍应进入同一回合折叠，
  // 不能只在实时事件累积的内存消息中可见。
  await app.close();
  const restoredApp = await launchElectronApp(launchOptions(foldWorkspace));
  const restoredPage = await restoredApp.firstWindow();
  await waitSessionReady(restoredPage);
  await restoredPage.locator('.sidebar-session').filter({ hasText: 'REASONING_TURN' }).click();
  await expect(restoredPage.getByTestId('message-assistant').filter({ hasText: 'FINAL: reasoning complete' })).toBeVisible({ timeout: 30_000 });
  const restoredToggle = restoredPage.getByTestId('turn-fold-toggle').last();
  await expect(restoredToggle).toBeVisible();
  await restoredToggle.click();
  await expect(restoredPage.locator('.thinking-block pre')).toContainText('THOUGHT: inspect the request');
});

test('展开本轮过程会显示完整工具输出，工具卡仍可单独收起', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions(foldWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendPrompt(page, 'USE_TOOL_LINES');
  const toggle = page.getByTestId('turn-fold-toggle').last();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
  await toggle.click();

  const body = page.getByTestId('turn-fold-content').getByTestId('tool-card-body');
  await expect(body).toBeVisible();
  await expect(body).toContainText('line-01');
  await expect(body).toContainText('line-12');
  await page.screenshot({ path: 'output/playwright/turn-fold-long-output.png', fullPage: false });

  await page.getByTestId('turn-fold-content').locator('.tool-card-header').click();
  await expect(body).toHaveCount(0);
  const preview = page.getByTestId('turn-fold-content').locator('.tool-card-preview pre');
  await expect(preview).toContainText('line-12');
  await expect(preview).not.toContainText('line-01');
});
