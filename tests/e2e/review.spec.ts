// Review 面板 E2E（真 pi + mock provider + 临时 git repo workspace，不烧 API quota）。
// 覆盖：baseline 捕获（runtime 创建时）→ 改动文件列表 → diff 渲染 → 文件级回滚后磁盘复原；
// agent 新建文件（untracked）纳入清单；非 Git 目录也使用临时 baseline 完整评审。
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
/** 非 Git workspace（临时 object store 路径） */
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
  await writeFile(path.join(repoWorkspace, 'src', 'preview.ts'), `export const answer = 42;\n// ${'adaptive-preview-'.repeat(30)}\n`);
  await writeFile(
    path.join(repoWorkspace, 'preview.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  );
  git(repoWorkspace, ['init']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

  await writeFile(path.join(plainWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
  await writeFile(path.join(plainWorkspace, 'delete-me.txt'), 'remove me\n');

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

async function openReview(page: import('@playwright/test').Page) {
  await page.getByTestId('workspace-toggle').click();
  await page.getByTestId('workspace-review-tab').click();
}

/** 驱动 mock agent 执行一个工具调用并等工具卡片完成 */
async function runTool(page: import('@playwright/test').Page, prompt: string) {
  await page.getByTestId('chat-input').fill(prompt);
  await page.getByTestId('chat-send').click();
  const summary = page.getByTestId('turn-fold-toggle').last();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await summary.click();
  await page.getByTestId('process-stage-toggle').last().click();
  await expect(page.getByTestId('tool-card').last().locator('.tool-status')).toHaveText('done');
}

test('git 仓库：改动文件列表 + diff 渲染 + 文件级回滚后磁盘复原', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_EDIT now');

  await openReview(page);
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();

  // 评审态下标题栏开关同样能收起面板（回归：reviewOpen 时开关曾失效）
  await page.getByTestId('workspace-toggle').click();
  await expect(panel).toBeHidden();
  await openReview(page);
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
  await page.setViewportSize({ width: 1440, height: 800 });

  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('workspace-tree')).toBeVisible();

  // Long tool output must scroll inside the chat column and never push the panel beyond the viewport.
  await page.getByTestId('chat-input').fill('USE_TOOL_LONG now');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('turn-fold-toggle')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('turn-fold-toggle').click();
  await page.getByTestId('process-stage-toggle').click();
  const viewport = page.viewportSize();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width + 1);

  const initialWidth = (await panel.boundingBox())!.width;
  const initialChatWidth = (await page.locator('.chat-column').boundingBox())!.width;
  const handle = panel.getByTestId('workspace-resize-handle');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 4, handleBox!.y + 100);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 70, handleBox!.y + 100);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(initialWidth - 40);
  await expect.poll(async () => (await page.locator('.chat-column').boundingBox())!.width).toBeGreaterThan(initialChatWidth + 40);

  // 过窄窗口自动切成覆盖层工作台，不要求用户手动拖宽（≥960px 时停靠并排）。
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(handle).toBeHidden();
  await expect.poll(async () => {
    const panelWidth = (await panel.boundingBox())!.width;
    const pageWidth = (await page.locator('.chat-page').boundingBox())!.width;
    return Math.abs(panelWidth - pageWidth);
  }).toBeLessThan(2);

  // 拖出覆盖层断点后又回到停靠模式
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(handle).toBeVisible();
  // 覆盖层期间宽度被钳到最小，拖宽后再继续树/预览断言
  const dockedBox = await handle.boundingBox();
  await page.mouse.move(dockedBox!.x + 4, dockedBox!.y + 100);
  await page.mouse.down();
  await page.mouse.move(dockedBox!.x - 300, dockedBox!.y + 100);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(500);

  await panel.getByTestId('workspace-directory').filter({ hasText: 'src' }).click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.ts' }).click();
  const textPreview = panel.getByTestId('workspace-text-preview');
  await expect(textPreview).toContainText('answer = 42');
  await expect(textPreview.locator('.workspace-code-number').first()).toHaveText('1');
  await expect(panel.getByTestId('workspace-open-with')).toBeVisible();
  await panel.getByTestId('workspace-open-with').click();
  await expect(panel.getByTestId('workspace-open-menu')).toBeVisible();
  await expect(panel.getByTestId('workspace-open-menu')).toContainText(/默认应用|default application/);
  await page.screenshot({ path: 'output/playwright/workspace-preview-open-menu.png', fullPage: false });
  await panel.getByTestId('workspace-open-with').click();
  const previewColors = await panel.evaluate((node) => {
    const preview = node.querySelector('.workspace-text-preview');
    const view = node.ownerDocument.defaultView!;
    return [view.getComputedStyle(node).backgroundColor, preview ? view.getComputedStyle(preview).backgroundColor : ''];
  });
  expect(previewColors[1]).toBe(previewColors[0]);

  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.png' }).click();
  await expect(panel.getByTestId('workspace-image-preview').locator('img')).toBeVisible();
  await expect(panel.getByTestId('workspace-file-tab')).toHaveCount(2);
  await expect(panel.getByTestId('workspace-close-all')).toBeVisible();
  await panel.getByTestId('workspace-close-all').click();
  await expect(panel.getByTestId('workspace-file-tab')).toHaveCount(0);
  await expect(panel.getByTestId('workspace-preview')).toContainText(/Select a file|选择文件/);

  // Review 与 Files 可反复切换，不会被 reviewOpen effect 弹回。
  await panel.getByTestId('workspace-review-tab').click();
  await expect(panel.locator('.review-workspace')).toBeVisible();
  await panel.getByTestId('workspace-files-tab').click();
  await expect(panel.getByTestId('workspace-tree')).toBeVisible();
  await panel.getByTestId('workspace-review-tab').click();
  await panel.getByTestId('workspace-files-tab').click();
  await expect(panel.getByTestId('workspace-tree')).toBeVisible();

  await panel.getByTestId('workspace-close').click();
  await expect(panel).toBeHidden();
});

test('read 图片工具卡：预览按钮直达右侧图片查看器', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_READ_IMAGE now');
  const card = page.getByTestId('tool-card').last();
  await card.getByTestId('tool-preview-file').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('workspace-image-preview').locator('img')).toBeVisible();
});

test('git 仓库：agent 新建文件（untracked）纳入清单，回滚后文件删除', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_WRITE now');
  expect(existsSync(path.join(repoWorkspace, 'e2e-new-file.txt'))).toBe(true);

  await openReview(page);
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

test('非 Git 目录：新增/修改/删除进入评审并可回滚', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(plainWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_EDIT now');
  await writeFile(path.join(plainWorkspace, 'plain-new.txt'), 'new file\n');
  await rm(path.join(plainWorkspace, 'delete-me.txt'), { force: true });

  await openReview(page);
  const panel = page.getByTestId('review-panel');
  await expect(panel.getByTestId('review-fallback')).toHaveCount(0);
  await expect(panel.getByTestId('review-file').filter({ hasText: 'e2e-edit-target.txt' })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId('review-file').filter({ hasText: 'plain-new.txt' })).toBeVisible();
  await expect(panel.getByTestId('review-file').filter({ hasText: 'delete-me.txt' })).toBeVisible();

  for (const name of ['e2e-edit-target.txt', 'plain-new.txt', 'delete-me.txt']) {
    const row = panel.getByTestId('review-file').filter({ hasText: name });
    await row.getByTestId('revert-file').click();
    await page.getByTestId('review-confirm-ok').click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  }
  await expect(readFile(path.join(plainWorkspace, 'e2e-edit-target.txt'), 'utf8')).resolves.toBe('alpha\ngamma\n');
  expect(existsSync(path.join(plainWorkspace, 'plain-new.txt'))).toBe(false);
  await expect(readFile(path.join(plainWorkspace, 'delete-me.txt'), 'utf8')).resolves.toBe('remove me\n');
});
