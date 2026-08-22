// Review 面板 E2E（真 pi + mock provider + 临时 git repo workspace，不烧 API quota）。
// 覆盖：Git HEAD / 非 Git 会话 baseline → 改动文件列表 → diff 渲染 → 文件级回滚；
// staged、unstaged、untracked、conflict 与 agent 新建文件都纳入清单。
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';
import { createDocxFixture, createPdfFixture, createXlsxFixture } from '../helpers/document-fixtures';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
/** git 仓库 workspace（评审主路径） */
let repoWorkspace: string;
/** 非 Git workspace（临时 object store 路径） */
let plainWorkspace: string;
/** 启动 runtime 前已存在各类 Git 状态的 workspace。 */
let dirtyWorkspace: string;

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString();
const externalHistoryFile = '/tmp/pi-desktop-external-history.txt';

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
  dirtyWorkspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-dirty-repo-'));
  // Windows 上 /tmp/... 解析为 <盘符>:\tmp\...，目录不一定存在；POSIX 上 mkdir 幂等
  await mkdir(path.dirname(externalHistoryFile), { recursive: true });
  await writeFile(externalHistoryFile, 'external history preview\n');

  // edit 工具 E2E 的目标文件（mock 会把 alpha → beta）；git 仓库含一个初始 commit
  await writeFile(path.join(repoWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
  await mkdir(path.join(repoWorkspace, 'src'));
  await writeFile(path.join(repoWorkspace, 'src', 'preview.ts'), `export const answer = 42;\n// ${'adaptive-preview-'.repeat(30)}\n`);
  await writeFile(
    path.join(repoWorkspace, 'preview.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  );
  await writeFile(path.join(repoWorkspace, 'preview.md'), '# Preview Guide\n\nMarkdown renders as a document.\n\n| Format | State |\n| --- | --- |\n| PDF | Ready |\n\n```bash\necho first\necho second\n```\n');
  await writeFile(path.join(repoWorkspace, 'preview.csv'), 'Name,Status\nAlpha,Ready\nBeta,Queued\n');
  await writeFile(path.join(repoWorkspace, 'preview.pdf'), createPdfFixture());
  await writeFile(path.join(repoWorkspace, 'preview.docx'), createDocxFixture());
  await writeFile(path.join(repoWorkspace, 'preview.xlsx'), createXlsxFixture());
  git(repoWorkspace, ['init']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  git(repoWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

  await writeFile(path.join(plainWorkspace, 'e2e-edit-target.txt'), 'alpha\ngamma\n');
  await writeFile(path.join(plainWorkspace, 'delete-me.txt'), 'remove me\n');

  await writeFile(path.join(dirtyWorkspace, 'staged.txt'), 'base staged\n');
  await writeFile(path.join(dirtyWorkspace, 'unstaged.txt'), 'base unstaged\n');
  await writeFile(path.join(dirtyWorkspace, 'conflict.txt'), 'base conflict\n');
  git(dirtyWorkspace, ['init']);
  git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'base']);
  const baseBranch = git(dirtyWorkspace, ['branch', '--show-current']).trim();
  git(dirtyWorkspace, ['checkout', '-b', 'conflict-other']);
  await writeFile(path.join(dirtyWorkspace, 'conflict.txt'), 'theirs\n');
  git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'conflict.txt']);
  git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'theirs']);
  git(dirtyWorkspace, ['checkout', baseBranch]);
  await writeFile(path.join(dirtyWorkspace, 'conflict.txt'), 'ours\n');
  git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'conflict.txt']);
  git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ours']);
  try {
    git(dirtyWorkspace, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'conflict-other']);
  } catch {
    // Expected: keep the UU index/worktree state for Review coverage.
  }
  await writeFile(path.join(dirtyWorkspace, 'staged.txt'), 'changed in index\n');
  git(dirtyWorkspace, ['add', 'staged.txt']);
  await writeFile(path.join(dirtyWorkspace, 'unstaged.txt'), 'changed in worktree\n');
  await writeFile(path.join(dirtyWorkspace, 'untracked.txt'), 'not tracked\n');

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
  await rm(dirtyWorkspace, { recursive: true, force: true });
  await rm(externalHistoryFile, { force: true });
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

  // 评审态下标题栏开关同样能收起面板
  await page.getByTestId('workspace-toggle').click();
  await expect(panel).toBeHidden();
  await openReview(page);
  await expect(panel).toBeVisible();

  // 本会话改动与工作区改动两分组均出现
  const sessionGroup = panel.getByTestId('review-group-session');
  const workspaceGroup = panel.getByTestId('review-group-workspace');
  await expect(sessionGroup).toBeVisible({ timeout: 30_000 });
  await expect(workspaceGroup).toBeVisible();

  const sessionFile = sessionGroup.getByTestId('review-file').filter({ hasText: 'e2e-edit-target.txt' });
  await expect(sessionFile).toBeVisible();
  await expect(sessionFile.getByTestId('review-file-scope')).toHaveText(/会话|Session/);
  await expect(sessionFile.getByTestId('revert-file')).toHaveCount(0);

  const workspaceFile = workspaceGroup.getByTestId('review-file').filter({ hasText: 'e2e-edit-target.txt' });
  await expect(workspaceFile).toBeVisible();
  await expect(workspaceFile.locator('.review-stat-add')).toHaveText('+1');
  await expect(workspaceFile.locator('.review-stat-del')).toHaveText('-1');

  // 点击工作区文件，diff 活视图渲染（删除红 / 新增绿）
  await workspaceFile.locator('.review-file-main').click();
  const diff = panel.getByTestId('review-diff');
  await expect(diff).toBeVisible();
  await expect(diff.locator('.diff-del')).toContainText('alpha');
  await expect(diff.locator('.diff-add')).toContainText('beta');
  await expect(panel.getByTestId('diff-split')).toBeVisible();
  await panel.getByTestId('review-toggle-mode').click();
  await expect(panel.getByTestId('diff-unified')).toBeVisible();

  // 文件级回滚：确认对话框 → git apply -R → 磁盘复原、工作区清单清空（会话历史记录保留）
  await workspaceFile.getByTestId('revert-file').click();
  await expect(page.getByTestId('review-confirm')).toBeVisible();
  await page.getByTestId('review-confirm-ok').click();

  await expect(workspaceGroup.getByTestId('review-file')).toHaveCount(0, { timeout: 30_000 });
  await expect(sessionGroup.getByTestId('review-file')).toHaveCount(1);
  const content = await readFile(path.join(repoWorkspace, 'e2e-edit-target.txt'), 'utf-8');
  expect(content).toBe('alpha\ngamma\n');
});

test('git 仓库：启动前 staged/unstaged/untracked/conflict 全部进入 Review', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(dirtyWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await openReview(page);

  const panel = page.getByTestId('review-panel');
  const fileList = panel.getByTestId('review-file-list');
  for (const name of ['staged.txt', 'unstaged.txt', 'untracked.txt', 'conflict.txt']) {
    await expect(fileList.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
  }

  const conflict = panel.getByTestId('review-file').filter({ hasText: 'conflict.txt' });
  await expect(conflict.getByTestId('review-file-status')).toHaveText(/Conflict|冲突/);
  await expect(conflict.getByTestId('revert-file')).toHaveCount(0);
  await conflict.locator('.review-file-main').click();
  await expect(panel.getByTestId('review-diff')).toContainText('<<<<<<<');
  await expect(panel.getByTestId('revert-hunk')).toHaveCount(0);
  await page.screenshot({ path: 'output/playwright/review-complete-git-state.png', fullPage: false });
});

test('右侧工作台：按需展开目录并预览文本和图片', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.setViewportSize({ width: 1600, height: 800 });

  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('workspace-tree')).toBeVisible();
  const treeToggle = panel.getByTestId('workspace-tree-toggle');
  await expect(treeToggle).toBeVisible();
  await expect(treeToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(treeToggle.locator('span')).toHaveText(/\d+/);
  // 默认 docked：聊天列与面板并排
  await expect(panel).toHaveAttribute('data-mode', 'docked');
  await page.screenshot({ path: 'output/playwright/workspace-tree-overlay.png', fullPage: false });

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

  // Switch to overlay mode and verify overlay behavior
  const modeToggle = panel.getByTestId('workspace-mode-toggle');
  await modeToggle.click();
  await expect(panel).toHaveAttribute('data-mode', 'overlay');

  await panel.getByTestId('workspace-directory').filter({ hasText: 'src' }).click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.ts' }).click();
  await expect(panel.getByTestId('workspace-tree')).toBeHidden();
  await expect(treeToggle).toHaveAttribute('aria-expanded', 'false');
  const textPreview = panel.getByTestId('workspace-text-preview');
  await expect(textPreview).toContainText('answer = 42');
  await expect(textPreview).toHaveAttribute('data-language', 'typescript');
  await expect(textPreview.locator('.workspace-code-number').first()).toHaveText('1');
  await expect(textPreview.locator('.workspace-code-token')).not.toHaveCount(0);
  await expect(panel.getByTestId('workspace-toggle-wrap')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => textPreview.locator('.workspace-code-line code').first().evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).whiteSpace)).toBe('pre-wrap');
  await page.screenshot({ path: 'output/playwright/workspace-code-preview-wrapped.png', fullPage: false });
  await panel.getByTestId('workspace-toggle-wrap').click();
  await expect(panel.getByTestId('workspace-toggle-wrap')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => textPreview.locator('.workspace-code-line code').first().evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).whiteSpace)).toBe('pre');
  await page.screenshot({ path: 'output/playwright/workspace-code-preview.png', fullPage: false });
  await expect(panel.getByTestId('workspace-open-with')).toBeVisible();
  await panel.getByTestId('workspace-open-with').click();
  await expect(panel.getByTestId('workspace-open-menu')).toBeVisible();
  await expect(panel.getByTestId('workspace-open-menu')).toContainText(/默认应用|default application/);
  const applicationButtons = panel.getByTestId('workspace-open-application');
  const applicationCount = await applicationButtons.count();
  for (let index = 0; index < applicationCount; index += 1) {
    await expect(applicationButtons.nth(index).locator('img, svg')).toHaveCount(1);
  }
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
  await panel.getByTestId('workspace-image-preview').locator('img').click();
  await expect(page.getByTestId('image-lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-lightbox')).toHaveCount(0);
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

test('右侧工作台：Markdown、PDF、Word、Excel 和 CSV 使用专用预览', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');

  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.md' }).click();
  const markdown = panel.getByTestId('workspace-markdown-preview');
  await expect(markdown).toContainText('Preview Guide');
  await expect(markdown.locator('table')).toBeVisible();
  await expect.poll(() =>
    markdown.locator('[data-streamdown="code-block-body"] code').evaluate((node) =>
      node.ownerDocument.defaultView!.getComputedStyle(node).whiteSpace
    )
  ).toBe('pre');
  await page.screenshot({ path: 'output/playwright/workspace-markdown-preview.png', fullPage: false });
  await markdown.getByRole('button', { name: 'Source' }).click();
  await expect(markdown.getByTestId('workspace-text-preview')).toContainText('# Preview Guide');

  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.pdf' }).click();
  const pdf = panel.getByTestId('workspace-pdf-preview');
  const canvas = pdf.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(pdf).toContainText('Page 1 of 2', { timeout: 20_000 });
  await expect.poll(async () => canvas.evaluate((element) => element.width * element.height)).toBeGreaterThan(100_000);
  const nonWhitePixels = await canvas.evaluate((element) => {
    const context = element.getContext('2d');
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 400) {
      if (pixels[index + 3] > 0 && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) count += 1;
    }
    return count;
  });
  expect(nonWhitePixels).toBeGreaterThan(10);
  await page.screenshot({ path: 'output/playwright/workspace-pdf-preview.png', fullPage: false });
  await pdf.getByTitle('Next page').click();
  await expect(pdf).toContainText('Page 2 of 2');

  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.docx' }).click();
  const document = panel.getByTestId('workspace-document-preview');
  await expect(document).toContainText('Project Brief', { timeout: 30_000 });
  await expect(document).toContainText('Status');
  await expect(document).toContainText('Ready');
  await page.screenshot({ path: 'output/playwright/workspace-docx-preview.png', fullPage: false });

  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.xlsx' }).click();
  const spreadsheet = panel.getByTestId('workspace-spreadsheet-preview');
  await expect(spreadsheet.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  await expect(spreadsheet).toContainText('Preview');
  await spreadsheet.getByRole('tab', { name: 'Details' }).click();
  await expect(spreadsheet).toContainText('DOCX');
  await expect(spreadsheet).toContainText('Ready');
  await page.screenshot({ path: 'output/playwright/workspace-xlsx-preview.png', fullPage: false });

  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.csv' }).click();
  await expect(panel.getByTestId('workspace-spreadsheet-preview')).toContainText('Alpha');

  await page.setViewportSize({ width: 760, height: 820 });
  await panel.getByTestId('workspace-files-tab').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.pdf' }).click();
  const narrowPdf = panel.getByTestId('workspace-pdf-preview');
  await expect(narrowPdf).toContainText('Page 1 of 2', { timeout: 20_000 });
  const [toolbarBox, pagerBox, zoomBox] = await Promise.all([
    narrowPdf.locator('.workspace-preview-toolbar').boundingBox(),
    narrowPdf.locator('.workspace-pdf-pager').boundingBox(),
    narrowPdf.locator('.workspace-pdf-zoom').boundingBox(),
  ]);
  expect(toolbarBox).not.toBeNull();
  expect(pagerBox).not.toBeNull();
  expect(zoomBox).not.toBeNull();
  expect(pagerBox!.x + pagerBox!.width).toBeLessThanOrEqual(zoomBox!.x);
  expect(zoomBox!.x + zoomBox!.width).toBeLessThanOrEqual(toolbarBox!.x + toolbarBox!.width + 1);
  await page.screenshot({ path: 'output/playwright/workspace-pdf-preview-narrow.png', fullPage: false });
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

test('历史会话恢复后仍可预览工作区外的工具文件', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_READ_EXTERNAL_HISTORY');
  const liveCard = page.getByTestId('tool-card').last();
  await liveCard.getByTestId('tool-preview-file').click();
  await expect(page.getByTestId('workspace-preview')).toContainText('external history preview');
  await app.close();

  const restoredApp = await launchElectronApp(launchOptions(repoWorkspace));
  const restoredPage = await restoredApp.firstWindow();
  await waitSessionReady(restoredPage);
  await restoredPage.locator('.sidebar-session').filter({ hasText: 'USE_TOOL_READ_EXTERNAL_HISTORY' }).click();
  const turn = restoredPage.getByTestId('turn-fold-toggle').last();
  await expect(turn).toBeVisible({ timeout: 30_000 });
  await turn.click();
  await restoredPage.getByTestId('process-stage-toggle').last().click();
  const restoredCard = restoredPage.getByTestId('tool-card').last();
  await restoredCard.getByTestId('tool-preview-file').click();
  await expect(restoredPage.getByTestId('workspace-preview')).toContainText('external history preview');
  await restoredPage.screenshot({ path: 'output/playwright/external-history-preview.png', fullPage: false });
  await restoredApp.close();
});

test('重新进入历史会话：评审面板仍能展示该会话的文件改动与 diff', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_EDIT history-diff');
  await app.close();

  const restoredApp = await launchElectronApp(launchOptions(repoWorkspace));
  const restoredPage = await restoredApp.firstWindow();
  await waitSessionReady(restoredPage);

  await restoredPage.locator('.sidebar-session').filter({ hasText: 'USE_TOOL_EDIT history-diff' }).first().click();
  await expect(restoredPage.getByTestId('turn-fold-toggle')).toBeVisible({ timeout: 30_000 });

  await openReview(restoredPage);
  const panel = restoredPage.getByTestId('review-panel');
  await expect(panel).toBeVisible();

  const sessionGroup = panel.getByTestId('review-group-session');
  await expect(sessionGroup).toBeVisible();
  const fileRow = sessionGroup.getByTestId('review-file').filter({ hasText: 'e2e-edit-target.txt' });
  await expect(fileRow).toBeVisible();
  await expect(fileRow.getByTestId('review-file-scope')).toHaveText(/会话|Session/);
  await expect(fileRow.getByTestId('revert-file')).toHaveCount(0);

  await fileRow.locator('.review-file-main').click();
  const toolDiff = panel.getByTestId('review-tool-diff');
  await expect(toolDiff).toBeVisible();
  await expect(toolDiff.locator('.diff-del')).toContainText('alpha');
  await expect(toolDiff.locator('.diff-add')).toContainText('beta');

  await restoredApp.close();
});

test('git 仓库：agent 新建文件（untracked）纳入清单，回滚后文件删除', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await runTool(page, 'USE_TOOL_WRITE now');
  expect(existsSync(path.join(repoWorkspace, 'e2e-new-file.txt'))).toBe(true);

  await openReview(page);
  const panel = page.getByTestId('review-panel');
  const workspaceGroup = panel.getByTestId('review-group-workspace');
  const fileRow = workspaceGroup.getByTestId('review-file').filter({ hasText: 'e2e-new-file.txt' });
  await expect(fileRow).toBeVisible({ timeout: 30_000 });
  await expect(fileRow.locator('.review-stat-add')).toHaveText('+1');

  // 新文件 diff 为整文件新增
  await fileRow.locator('.review-file-main').click();
  const diff = panel.getByTestId('review-diff');
  await expect(diff.locator('.diff-add')).toContainText('hello from agent');

  // 回滚 = 删除新文件
  await fileRow.getByTestId('revert-file').click();
  await page.getByTestId('review-confirm-ok').click();
  await expect(workspaceGroup.getByTestId('review-file').filter({ hasText: 'e2e-new-file.txt' })).toHaveCount(0, { timeout: 30_000 });
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
  const workspaceGroup = panel.getByTestId('review-group-workspace');
  await expect(workspaceGroup.getByTestId('review-file').filter({ hasText: 'e2e-edit-target.txt' })).toBeVisible({ timeout: 30_000 });
  await expect(workspaceGroup.getByTestId('review-file').filter({ hasText: 'plain-new.txt' })).toBeVisible();
  await expect(workspaceGroup.getByTestId('review-file').filter({ hasText: 'delete-me.txt' })).toBeVisible();

  for (const name of ['e2e-edit-target.txt', 'plain-new.txt', 'delete-me.txt']) {
    const row = workspaceGroup.getByTestId('review-file').filter({ hasText: name });
    await row.getByTestId('revert-file').click();
    await page.getByTestId('review-confirm-ok').click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  }
  await expect(readFile(path.join(plainWorkspace, 'e2e-edit-target.txt'), 'utf8')).resolves.toBe('alpha\ngamma\n');
  expect(existsSync(path.join(plainWorkspace, 'plain-new.txt'))).toBe(false);
  await expect(readFile(path.join(plainWorkspace, 'delete-me.txt'), 'utf8')).resolves.toBe('remove me\n');
});

test('工作台展开模式：默认 docked 窗口向右扩大 + 窄窗口回退 overlay + 模式切换与持久化', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const getWindowWidth = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width);
  // 窗口移到所在显示器左缘，保证右侧有充足扩展空间（宽度断言才有确定性）
  await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds({ x: area.x, y: area.y + 40, width: 1440, height: 800 });
  });

  // 1. 默认 docked：窗口向右加宽 ≈ 面板宽，聊天列保持展开前像素宽
  const initialChatBox = await page.locator('.chat-column').boundingBox();
  expect(initialChatBox).not.toBeNull();
  const initialWindowWidth = await getWindowWidth();

  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-mode', 'docked');
  await expect(panel).toHaveAttribute('data-mode-preference', 'docked');

  await expect.poll(getWindowWidth).toBeGreaterThan(initialWindowWidth + 100);
  const appliedWidth = (await getWindowWidth()) - initialWindowWidth;
  // 加宽量 == 面板像素宽（窗口加宽动画与面板滑入动画结束后断言）
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return box ? Math.abs(box.width - appliedWidth) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(4);
  // 聊天列不被压缩：docked 解除 max-width 上限后只会更宽，不会比展开前窄
  const dockedChatBox = await page.locator('.chat-column').boundingBox();
  expect(dockedChatBox).not.toBeNull();
  expect(dockedChatBox!.width).toBeGreaterThanOrEqual(initialChatBox!.width - 2);

  // 2. docked 下 Esc 只收目录树，不收面板
  const treeToggle = panel.getByTestId('workspace-tree-toggle');
  await expect(treeToggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(treeToggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();

  // 3. 超窄窗口：显式 docked 也回退 overlay，避免面板被压成细条；
  //    宽度被外部改变后扩窗状态按「用户改过尺寸」放弃缩回
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(panel).toHaveAttribute('data-mode', 'overlay');
  await expect(panel).toHaveAttribute('data-mode-preference', 'docked');
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(panel).toHaveAttribute('data-mode', 'docked');

  // 4. 模式切换按钮：docked -> overlay -> auto -> docked
  const modeToggle = panel.getByTestId('workspace-mode-toggle');
  await expect(modeToggle).toBeVisible();

  // 切换到 overlay：窗口缩回原宽，聊天列恢复，遮罩出现，点遮罩收面板
  await modeToggle.click();
  await expect(panel).toHaveAttribute('data-mode', 'overlay');
  await expect(panel).toHaveAttribute('data-mode-preference', 'overlay');
  await expect.poll(getWindowWidth).toBe(initialWindowWidth);
  const overlayChatBox = await page.locator('.chat-column').boundingBox();
  expect(overlayChatBox).not.toBeNull();
  expect(Math.abs(overlayChatBox!.width - initialChatBox!.width)).toBeLessThan(2);
  expect(Math.abs(overlayChatBox!.x - initialChatBox!.x)).toBeLessThan(2);
  const backdrop = page.getByTestId('workspace-backdrop');
  await expect(backdrop).toBeVisible();
  await backdrop.click({ position: { x: 50, y: 50 } });
  await expect(panel).toBeHidden();

  // 5. auto 模式：1440px 下 overlay，1800px 下 docked（宽度自适应）
  await page.getByTestId('workspace-toggle').click();
  await expect(panel).toBeVisible();
  await modeToggle.click();
  await expect(panel).toHaveAttribute('data-mode-preference', 'auto');
  await expect(panel).toHaveAttribute('data-mode', 'overlay');
  await page.setViewportSize({ width: 1800, height: 800 });
  await expect(panel).toHaveAttribute('data-mode', 'docked');
  const wideChatBox = await page.locator('.chat-column').boundingBox();
  expect(wideChatBox).not.toBeNull();
  expect(wideChatBox!.width).toBeGreaterThanOrEqual(560);

  // 6. 双击调整手柄也可切换模式，偏好持久化到 localStorage（字符串表达式求值，避免在 node 侧 tsconfig 引用 DOM 类型）
  const handle = panel.getByTestId('workspace-resize-handle');
  await handle.dblclick();
  await expect(panel).toHaveAttribute('data-mode-preference', 'docked');
  await expect(panel).toHaveAttribute('data-mode', 'docked');
  await expect
    .poll(() => page.evaluate("window.localStorage.getItem('pi-desktop.workspace-panel-mode')"))
    .toBe('docked');
});

test('文件区内部排版：目录树与预览并排无遮挡 + 空态可见 + 代码横向滚动 + 图片容器约束', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(repoWorkspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await page.setViewportSize({ width: 1600, height: 800 });

  // 打开工作台
  await page.getByTestId('workspace-toggle').click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible();

  // 1. 宽面板下：目录树与预览区并排，预览区左缘 >= 目录树右缘（无重叠遮挡）
  const tree = panel.getByTestId('workspace-tree');
  const preview = panel.getByTestId('workspace-preview');
  await expect(tree).toBeVisible();
  await expect(preview).toBeVisible();

  const empty = panel.locator('.workspace-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/Select a file|选择文件/);

  await expect.poll(async () => {
    const treeBox = await tree.boundingBox();
    const previewBox = await preview.boundingBox();
    if (!treeBox || !previewBox) return false;
    return previewBox.x >= treeBox.x + treeBox.width - 2;
  }).toBe(true);

  // 2. 空态文字完整位于预览区内，未被目录树覆盖
  await expect.poll(async () => {
    const treeBox = await tree.boundingBox();
    const emptyBox = await empty.boundingBox();
    if (!treeBox || !emptyBox) return false;
    return emptyBox.x >= treeBox.x + treeBox.width - 2;
  }).toBe(true);

  // 3. 打开含超长行的代码文件
  await panel.getByTestId('workspace-directory').filter({ hasText: 'src' }).click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.ts' }).click();
  const textPreview = panel.getByTestId('workspace-text-preview');
  await expect(textPreview).toBeVisible();

  // 关闭自动换行后：代码容器出现横向可滚动能力且内容不裁切
  const wrapBtn = panel.getByTestId('workspace-toggle-wrap');
  await expect(wrapBtn).toHaveAttribute('aria-pressed', 'true');
  await wrapBtn.click();
  await expect(wrapBtn).toHaveAttribute('aria-pressed', 'false');
  const isScrollableX = await panel.locator('.workspace-file-content').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(isScrollableX).toBe(true);

  // 开启自动换行后：行内换行生效
  await wrapBtn.click();
  await expect(wrapBtn).toHaveAttribute('aria-pressed', 'true');

  // 4. 打开图片文件：图片高度受容器约束，不超过面板内容区
  await panel.getByTestId('workspace-tree-toggle').click();
  await panel.getByTestId('workspace-file').filter({ hasText: 'preview.png' }).click();
  const imgPreview = panel.getByTestId('workspace-image-preview');
  await expect(imgPreview).toBeVisible();
  const img = imgPreview.locator('img');
  await expect(img).toBeVisible();
  const imgBox = await img.boundingBox();
  const contentBox = await panel.locator('.workspace-file-content').boundingBox();
  expect(imgBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(imgBox!.height).toBeLessThanOrEqual(contentBox!.height + 2);

  // 5. 树展开/收起切换
  const treeToggle = panel.getByTestId('workspace-tree-toggle');
  await treeToggle.click();
  await expect(tree).toBeVisible();
  await treeToggle.click();
  await expect(tree).toBeHidden();
});
