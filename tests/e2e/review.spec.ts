// Review 面板 E2E（真 pi + mock provider + 临时 git repo workspace，不烧 API quota）。
// 覆盖：baseline 捕获（runtime 创建时）→ 改动文件列表 → diff 渲染 → 文件级回滚后磁盘复原；
// agent 新建文件（untracked）纳入清单；非 git 目录降级只读汇总。
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
/** git 仓库 workspace（评审主路径） */
let repoWorkspace: string;
/** 非 git workspace（降级只读路径） */
let plainWorkspace: string;

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

  // edit 工具 E2E 的目标文件（mock 会把 alpha → beta）；git 仓库含一个初始 commit
  await writeFile(path.join(repoWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
  await mkdir(path.join(repoWorkspace, 'src'));
  await writeFile(path.join(repoWorkspace, 'src', 'preview.ts'), 'export const answer = 42;\n');
  await writeFile(
    path.join(repoWorkspace, 'preview.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  );
  git(repoWorkspace, ['init']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

  await writeFile(path.join(plainWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');

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

/** 驱动 mock agent 执行一个工具调用并等工具卡片完成 */
async function runTool(page: import('@playwright/test').Page, prompt: string) {
  await page.getByTestId('chat-input').fill(prompt);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('tool-card').last().locator('.tool-status')).toHaveText('done', {
    timeout: 30_000,
  });
}

test('git 仓库：改动文件列表 + diff 渲染 + 文件级回滚后磁盘复原', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_EDIT now');

  await page.getByTestId('session-menu').click();
  await page.getByTestId('open-review').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();

  // 文件清单：e2e-edit-target.txt，+1/-1
  const fileRow = panel.getByTestId('review-file').filter({ hasText: 'e2e-edit-target.txt' });
  await expect(fileRow).toBeVisible({ timeout: 30_000 });
  await expect(fileRow.locator('.review-stat-add')).toHaveText('+1');
  await expect(fileRow.locator('.review-stat-del')).toHaveText('-1');

  // 第一个文件默认选中，diff 活视图渲染（删除红 / 新增绿）
  const diff = panel.getByTestId('review-diff');
  await expect(diff).toBeVisible();
  await expect(diff.locator('.diff-del')).toContainText('alpha');
  await expect(diff.locator('.diff-add')).toContainText('beta');
  await expect(panel.getByTestId('diff-split')).toBeVisible();
  await panel.getByTestId('review-toggle-mode').click();
  await expect(panel.getByTestId('diff-unified')).toBeVisible();

  // 文件级回滚：确认对话框 → git apply -R → 磁盘复原、清单清空
  await fileRow.getByTestId('revert-file').click();
  await expect(page.getByTestId('review-confirm')).toBeVisible();
  await page.getByTestId('review-confirm-ok').click();

  await expect(panel.getByTestId('review-file')).toHaveCount(0, { timeout: 30_000 });
  const content = await readFile(path.join(repoWorkspace, 'e2e-edit-target.txt'), 'utf-8');
  expect(content).toBe('alpha\ngamma\n');
});

test('右侧工作台：按需展开目录并预览文本和图片', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('workspace-tree')).toBeVisible();

  await panel.getByTestId('workspace-directory').filter({ hasText: 'src' }).click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.ts' }).click();
  await expect(panel.getByTestId('workspace-text-preview')).toContainText('answer = 42');

  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.png' }).click();
  await expect(panel.getByTestId('workspace-image-preview').locator('img')).toBeVisible();

  await panel.getByTestId('workspace-close').click();
  await expect(panel).toBeHidden();
});

test('git 仓库：agent 新建文件（untracked）纳入清单，回滚后文件删除', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_WRITE now');
  expect(existsSync(path.join(repoWorkspace, 'e2e-new-file.txt'))).toBe(true);

  await page.getByTestId('session-menu').click();
  await page.getByTestId('open-review').click();
  const panel = page.getByTestId('review-panel');
  const fileRow = panel.getByTestId('review-file').filter({ hasText: 'e2e-new-file.txt' });
  await expect(fileRow).toBeVisible({ timeout: 30_000 });
  await expect(fileRow.locator('.review-stat-add')).toHaveText('+1');

  // 新文件 diff 为整文件新增
  await fileRow.locator('.review-file-main').click();
  const diff = panel.getByTestId('review-diff');
  await expect(diff.locator('.diff-add')).toContainText('hello from agent');

  // 回滚 = 删除新文件
  await fileRow.getByTestId('revert-file').click();
  await page.getByTestId('review-confirm-ok').click();
  await expect(panel.getByTestId('review-file')).toHaveCount(0, { timeout: 30_000 });
  expect(existsSync(path.join(repoWorkspace, 'e2e-new-file.txt'))).toBe(false);
});

test('非 git 目录：降级为只读汇总（无回滚按钮）', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(plainWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_EDIT now');

  await page.getByTestId('session-menu').click();
  await page.getByTestId('open-review').click();
  const fallback = page.getByTestId('review-fallback');
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  await expect(fallback).toContainText('e2e-edit-target.txt');
  // 降级视图无回滚入口
  await expect(page.getByTestId('revert-file')).toHaveCount(0);
  await expect(page.getByTestId('revert-hunk')).toHaveCount(0);
});
