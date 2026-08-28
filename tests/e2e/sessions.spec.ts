// 会话管理 E2E（列表/切换/重命名/删除，真 pi + mock provider，不烧 API quota）。
// 每个测试独立 agentDir（会话文件互相隔离），模式同 models.spec.ts。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

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

  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
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
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }),
  );
});

test.afterEach(async () => {
  // Windows 上进程退出后文件句柄释放有延迟，rm 加重试避免 ENOTEMPTY/EBUSY 抖动
  await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
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

/** 等会话启动（模型选择器/徽标出现 = runtime 就绪） */
async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 发一条消息并等 mock 回复落地（保证会话文件已写入） */
async function sendAndWaitReply(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

const sessionRows = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid^="session-row-"]');

test('未发送任何内容时进入 Sessions 页 → 显示空状态，无「未命名会话」', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('nav-sessions').click();
  await expect(page.getByTestId('sessions-empty')).toBeVisible({ timeout: 15_000 });
  await expect(sessionRows(page)).toHaveCount(0);
});

test('发消息 → Sessions 页出现该会话（firstMessage 匹配，标记为当前）', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG alpha');

  await page.getByTestId('nav-sessions').click();
  const row = sessionRows(page).filter({ hasText: 'Say PONG alpha' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row.getByTestId('session-current')).toBeVisible();
});

test('Sessions 页全局展示：跨工作区分组并显示位置信息（listAll）', async ({
  launchElectronApp,
}) => {
  // 预置第二个项目的会话文件（不走 runtime，直接写 pi 会话格式）
  const secondWorkspace = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-second-')));
  const secondName = secondWorkspace.split(/[\\/]/).filter(Boolean).pop() ?? 'second';
  const seedId = '019fe296-0000-7000-8000-000000000001';
  const seedTs = '2026-08-08T18:15:18.828Z';
  const encoded = `--${secondWorkspace.replace(/^\//, '').replace(/[\/\\:]/g, '-')}--`;
  const seedDir = path.join(agentDir, 'sessions', encoded);
  await mkdir(seedDir, { recursive: true });
  await writeFile(
    path.join(seedDir, `${seedTs.replace(/[:.]/g, '-')}_${seedId}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id: seedId, timestamp: seedTs, cwd: secondWorkspace }),
      JSON.stringify({
        type: 'message',
        id: 'aaaaaaaa',
        parentId: null,
        timestamp: '2026-08-08T18:15:25.270Z',
        message: { role: 'user', content: [{ type: 'text', text: 'seeded ZEBRA session' }], timestamp: Date.now() },
      }),
    ].join('\n') + '\n',
  );

  try {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    // 当前工作区也发一条消息，保证两个分组都有会话
    await sendAndWaitReply(page, 'Say PONG zebra-cross');

    await page.getByTestId('nav-sessions').click();

    // 第二个项目的分组头：项目名 + 完整路径（位置信息）+ 会话数
    const secondHeader = page.getByTestId(`session-project-${secondName}`);
    await expect(secondHeader).toBeVisible({ timeout: 15_000 });
    await expect(secondHeader).toContainText(secondWorkspace);

    // 预置会话出现在该项目分组下
    const secondGroup = page.locator('.session-project-group').filter({ has: secondHeader });
    await expect(secondGroup.locator('[data-testid^="session-row-"]').filter({ hasText: 'seeded ZEBRA session' })).toHaveCount(1);

    // 当前工作区分组同样可见（含刚发的会话）；路径以 runtime 实际使用的 workspaceCwd 为准
    const workspaceName = workspace.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace';
    const currentHeader = page.getByTestId(`session-project-${workspaceName}`);
    await expect(currentHeader).toBeVisible();
    await expect(currentHeader).toContainText(workspace);
    const currentGroup = page.locator('.session-project-group').filter({ has: currentHeader });
    await expect(currentGroup.locator('[data-testid^="session-row-"]').filter({ hasText: 'Say PONG zebra-cross' })).toHaveCount(1);
  } finally {
    await rm(secondWorkspace, { recursive: true, force: true });
  }
});

test('进入历史会话 → 消息列表定位在最新消息（底部）', async ({ launchElectronApp }) => {
  // 预置一个多轮长会话（内容高度远超视口）
  const secondWorkspace = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-scroll-')));
  const seedId = '019fe296-0000-7000-8000-000000000002';
  const seedTs = '2026-08-07T08:00:00.000Z';
  const encoded = `--${secondWorkspace.replace(/^\//, '').replace(/[\/\\:]/g, '-')}--`;
  const seedDir = path.join(agentDir, 'sessions', encoded);
  await mkdir(seedDir, { recursive: true });
  const lines = [JSON.stringify({ type: 'session', version: 3, id: seedId, timestamp: seedTs, cwd: secondWorkspace })];
  let parent: string | null = null;
  for (let i = 0; i < 40; i += 1) {
    const ts = new Date(Date.parse(seedTs) + i * 60_000).toISOString();
    const uid = `u${String(i).padStart(7, '0')}`;
    const aid = `a${String(i).padStart(7, '0')}`;
    lines.push(JSON.stringify({
      type: 'message', id: uid, parentId: parent, timestamp: ts,
      message: { role: 'user', content: [{ type: 'text', text: `scroll-seed question ${i}` }], timestamp: Date.parse(ts) },
    }));
    lines.push(JSON.stringify({
      type: 'message', id: aid, parentId: uid, timestamp: ts,
      message: { role: 'assistant', content: [{ type: 'text', text: `scroll-seed answer ${i}` }], timestamp: Date.parse(ts) },
    }));
    parent = aid;
  }
  await writeFile(path.join(seedDir, `${seedTs.replace(/[:.]/g, '-')}_${seedId}.jsonl`), lines.join('\n') + '\n');

  try {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('nav-sessions').click();
    const row = page.getByTestId(`session-row-${seedId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('.session-row-main').click();

    // 回到 chat：最后一条消息可见，且列表贴底（而不是停在第一条输入处）
    await expect(
      page.getByTestId('message-assistant').filter({ hasText: 'scroll-seed answer 39' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () => page.getByTestId('message-list').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(30);
  } finally {
    await rm(secondWorkspace, { recursive: true, force: true });
  }
});

test('Sessions 页删除非当前会话 → 文件真实移除且侧栏即时同步', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 会话 A（待删，删前已非当前）+ 会话 B（当前）
  await sendAndWaitReply(page, 'trash-sync GOLDFISH');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'trash-sync keep HERON');

  // 定位会话 A 的文件
  const findSessionFile = async (needle: string) => {
    const dirs = await readdir(path.join(agentDir, 'sessions'));
    for (const dirName of dirs) {
      const files = await readdir(path.join(agentDir, 'sessions', dirName));
      for (const f of files) {
        const full = path.join(agentDir, 'sessions', dirName, f);
        const content = await readFile(full, 'utf8').catch(() => '');
        if (content.includes(needle)) return full;
      }
    }
    return undefined;
  };
  const sessionFile = await findSessionFile('trash-sync GOLDFISH');
  expect(sessionFile).toBeTruthy();

  await page.getByTestId('nav-sessions').click();
  const row = sessionRows(page).filter({ hasText: 'trash-sync GOLDFISH' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await row.getByTestId('session-delete').click();
  await row.getByTestId('session-delete-confirm').click();

  // Sessions 页移除
  await expect(sessionRows(page).filter({ hasText: 'trash-sync GOLDFISH' })).toHaveCount(0, { timeout: 15_000 });
  // 侧栏即时同步（删非当前会话不会触发 sessionReplaced/runtimeStateChanged，靠 sessionsChanged）
  await expect(
    page.locator('.sidebar-session-row').filter({ hasText: 'trash-sync GOLDFISH' }),
  ).toHaveCount(0, { timeout: 3_000 });
  // 文件真的被移除（移入系统废纸篓）
  await expect(stat(sessionFile!)).rejects.toThrow();
});

test('导出 HTML → 按项目分类目录并在会话列表中标记已导出（有意义的文件名与最近导出联动）', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'export location OSPREY');
  await page.getByTestId('nav-sessions').click();
  const row = sessionRows(page).filter({ hasText: 'export location OSPREY' });
  await row.getByTestId('session-export').click();

  const exportInfo = page.getByTestId('sessions-export-info');
  await expect(exportInfo).toContainText('Recent exports', { timeout: 15_000 });
  await expect(exportInfo).toContainText('export location OSPREY');
  await expect(page.getByTestId('sessions-recent-list')).toBeVisible();
  await expect(page.getByTestId('session-recent-item')).toHaveCount(1);
  await expect(page.getByTestId('sessions-open-export')).toBeVisible();
  await expect(page.getByTestId('sessions-show-export')).toBeVisible();

  // 会话行显示已导出徽标、打开导出按钮与在文件夹中显示按钮
  await expect(row.getByTestId('session-exported')).toBeVisible();
  await expect(row.getByTestId('session-open-exported')).toBeVisible();
  await expect(row.getByTestId('session-show-exported')).toBeVisible();

  await page.screenshot({ path: 'output/playwright/session-export-actions.png', fullPage: false });

  await page.getByTestId('nav-settings').click();
  const directory = (await page.getByTestId('settings-export-directory').textContent())?.trim();
  expect(directory).toBeTruthy();
  expect(directory!.split(path.sep).slice(-2)).toEqual(['Pi Desktop', 'Exports']);
  const workspaceName = (await realpath(workspace)).split(/[\\/]/).filter(Boolean).pop()!;
  const projectExportDir = path.join(directory!, workspaceName);
  const exportedFiles = (await readdir(projectExportDir)).filter((name) => name.endsWith('.html'));
  expect(exportedFiles).toHaveLength(1);
  expect(exportedFiles[0]).toMatch(/^export location OSPREY_/);
  const exportedHtml = await readFile(path.join(projectExportDir, exportedFiles[0]), 'utf8');
  expect(exportedHtml).toContain('<script id="session-data" type="application/json">');

  await page.getByTestId('nav-sessions').click();
  await expect(page.getByTestId('sessions-export-info')).toContainText(exportedFiles[0]);
  await expect(page.getByTestId('sessions-open-export')).toBeVisible();
  await expect(row.getByTestId('session-exported')).toBeVisible();

  // 若用户手动删除导出文件，点击查看导出给出友好提示并清理状态
  await rm(path.join(projectExportDir, exportedFiles[0]));
  await row.getByTestId('session-open-exported').click();
  await expect(page.getByTestId('sessions-error')).toContainText('Exported file does not exist or has been removed');
  // 重新导出成功
  await row.getByTestId('session-export').click();
  await expect(exportInfo).toContainText('Recent exports', { timeout: 15_000 });
  const reExported = (await readdir(projectExportDir)).filter((name) => name.endsWith('.html'));
  expect(reExported).toHaveLength(1);

  // 再次删除文件后切换到其他页面再切回，会话页面自动检测文件不存在并清理导出状态
  await rm(path.join(projectExportDir, reExported[0]));
  await page.getByTestId('nav-models').click();
  await page.getByTestId('nav-sessions').click();
  // 切换回来后自动检测，无需用户点击，最近导出列表已自动清空且会话行已导出徽标消失
  await expect(page.getByTestId('sessions-recent-list')).toHaveCount(0);
  await expect(row.getByTestId('session-exported')).toHaveCount(0);
});

test('切换会话 → 消息列表恢复目标会话内容', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'session one ALPHA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'session two BRAVO');

  await page.getByTestId('nav-sessions').click();
  await expect(sessionRows(page)).toHaveCount(2, { timeout: 15_000 });

  // 点 ALPHA 那行切回去（切换成功后直接回到对话页）
  const alphaRow = sessionRows(page).filter({ hasText: 'session one ALPHA' });
  await alphaRow.locator('.session-row-main').click();
  await expect(page.getByTestId('nav-chat')).toHaveClass(/active/);
  await expect(page.getByTestId('message-user').last()).toContainText('session one ALPHA');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

test('任务 A 运行时可创建任务 B，切回 A 后继续控制并停止', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('HANG task A');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('message-assistant').last()).toContainText('waiting');

  await page.getByTestId('new-chat').click();
  await expect(page.getByTestId('chat-input')).toBeEditable({ timeout: 30_000 });
  await expect(page.getByTestId('message-user')).toHaveCount(0);
  await sendAndWaitReply(page, 'Say PONG task B');

  const taskARow = page.locator('.sidebar-session-row').filter({ hasText: 'HANG task A' });
  await expect(taskARow).toBeVisible({ timeout: 15_000 });
  await expect(taskARow.locator('[data-testid^="sidebar-session-running-"]')).toBeVisible();

  await taskARow.locator('[data-testid^="sidebar-session-"]').first().click();
  await expect(page.getByTestId('message-user').last()).toContainText('HANG task A');
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 15_000 });

  await taskARow.locator('.sidebar-session-menu-trigger').click();
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Continue in new chat' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Archive chats' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('chat-stop')).toHaveCount(0, { timeout: 15_000 });
  await expect(taskARow.locator('[data-testid^="sidebar-session-running-"]')).toHaveCount(0, {
    timeout: 15_000,
  });
});

test('侧栏会话入口：从其他功能页点击后切回对话并恢复目标消息', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'sidebar target KOALA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'sidebar current PANDA');
  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('nav-models')).toHaveClass(/active/);

  const target = page.locator('.sidebar-session-row').filter({ hasText: 'sidebar target KOALA' });
  await target.locator('[data-testid^="sidebar-session-"]').first().click();
  await expect(page.getByTestId('nav-chat')).toHaveClass(/active/);
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await expect(page.getByTestId('message-user').last()).toContainText('sidebar target KOALA');
});

test('重命名 → 列表显示新名', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'rename me please');

  await page.getByTestId('nav-sessions').click();
  const row = sessionRows(page).filter({ hasText: 'rename me please' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });

  await row.getByTestId('session-rename').click();
  await row.getByTestId('session-rename-input').fill('My Renamed Session');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(
    sessionRows(page).filter({ hasText: 'My Renamed Session' }),
  ).toHaveCount(1, { timeout: 15_000 });
});

test('删除（二次确认）→ 列表减少', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'delete me DELTA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'keep me ECHO');

  await page.getByTestId('nav-sessions').click();
  await expect(sessionRows(page)).toHaveCount(2, { timeout: 15_000 });

  const deltaRow = sessionRows(page).filter({ hasText: 'delete me DELTA' });
  await deltaRow.getByTestId('session-delete').click();
  // 未确认前不删
  await expect(sessionRows(page)).toHaveCount(2);
  await deltaRow.getByTestId('session-delete-confirm').click();

  await expect(sessionRows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(sessionRows(page).filter({ hasText: 'keep me ECHO' })).toHaveCount(1);
});

test('删除当前打开的会话 → 面板切到新会话并可继续发送', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'delete current JADE');
  const row = page.locator('.sidebar-session-row').filter({ hasText: 'delete current JADE' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('.sidebar-session-menu-trigger').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();

  // 侧栏行消失；正在查看被删会话的面板认领到新空会话（问候语回来）
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('message-user')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('chat-greeting')).toBeVisible();

  // 新会话可正常发送（此前面板绑在已删文件上，发送报 session not started）
  await sendAndWaitReply(page, 'after delete KITE');
  await expect(page.getByTestId('message-user').last()).toContainText('after delete KITE');
});

test('Sessions 页删除当前打开的唯一会话 → 回到空状态，不出现「未命名会话」', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'delete sole active session SAPPHIRE');
  await page.getByTestId('nav-sessions').click();

  const row = sessionRows(page).filter({ hasText: 'delete sole active session SAPPHIRE' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await row.getByTestId('session-delete').click();
  await row.getByTestId('session-delete-confirm').click();

  // Sessions 页清空，直接展示 empty 提示，绝不出现未命名会话
  await expect(page.getByTestId('sessions-empty')).toBeVisible({ timeout: 15_000 });
  await expect(sessionRows(page)).toHaveCount(0);
});

test('侧栏会话菜单 → 归档后移入已归档，可恢复；删除后消失', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'archive from sidebar FOX');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'delete from sidebar OWL');

  const workspaceName = path.basename(workspace);
  const archiveRow = page.locator('.sidebar-session-row').filter({ hasText: 'archive from sidebar FOX' });
  await archiveRow.locator('.sidebar-session-menu-trigger').click();
  await page.getByRole('button', { name: 'Archive chats' }).click();
  await page.getByTestId(`archived-session-group-header-${workspaceName}`).click();
  await expect(page.getByTestId('archived-sessions')).toContainText('archive from sidebar FOX');

  await page.getByTestId(`archived-session-group-menu-${workspaceName}`).click();
  await page.getByRole('button', { name: 'Restore archive' }).click();
  await expect(page.getByTestId('archived-sessions')).toHaveCount(0);
  await expect(page.locator('.sidebar-session-row').filter({ hasText: 'archive from sidebar FOX' })).toBeVisible();

  const deleteRow = page.locator('.sidebar-session-row').filter({ hasText: 'delete from sidebar OWL' });
  await deleteRow.locator('.sidebar-session-menu-trigger').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.locator('.sidebar-session-row').filter({ hasText: 'delete from sidebar OWL' })).toHaveCount(0);
});

test('侧栏会话菜单 → 复制 ID、重命名、在新聊天中继续', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'native session actions LYNX');
  const row = page.locator('.sidebar-session-row').filter({ hasText: 'native session actions LYNX' });
  await expect(row).toBeVisible({ timeout: 15_000 });

  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  const sessionTestId = await sessionButton.getAttribute('data-testid');
  const sessionId = sessionTestId?.replace('sidebar-session-', '');
  expect(sessionId).toBeTruthy();

  await row.click({ button: 'right' });
  const contextMenu = page.getByTestId(`session-context-menu-${sessionId}`);
  await expect(contextMenu).toBeVisible();
  const menuBox = await contextMenu.boundingBox();
  const viewport = await page.evaluate<{ width: number; height: number }>(
    '({ width: window.innerWidth, height: window.innerHeight })',
  );
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);
  await page.getByRole('button', { name: 'Copy session ID' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(sessionId);

  await row.click({ button: 'right' });
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const renameInput = page.getByTestId(`sidebar-session-rename-input-${sessionId}`);
  await renameInput.fill('Sidebar Renamed Session');
  await renameInput.press('Enter');
  const renamedRow = page.locator('.sidebar-session-row').filter({ hasText: 'Sidebar Renamed Session' });
  await expect(renamedRow).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('nav-sessions').click();
  await expect(sessionRows(page).filter({ hasText: 'Sidebar Renamed Session' })).toHaveCount(1);
  await page.getByTestId('nav-chat').click();

  await renamedRow.locator('.sidebar-session-menu-trigger').click();
  await page.getByRole('button', { name: 'Continue in new chat' }).click();
  await expect(page.locator('.sidebar-session-row')).toHaveCount(2, { timeout: 15_000 });
});

test('流式中删除会话 → 被拒绝且给出可读提示，流结束后可删除', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'delete while streaming HERON');
  const row = page.locator('.sidebar-session-row').filter({ hasText: 'delete while streaming HERON' });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // SLOW_END：30 chunk × 100ms 慢速流（3s 后自然结束）；趁流式进行中发起删除
  await page.getByTestId('chat-input').fill('SLOW_END delete while streaming');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 10_000 });
  await row.locator('.sidebar-session-menu-trigger').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();

  // main 拒绝删除（session is running）：列表回滚 + 顶部全局错误提示（而非静默复活）
  const notice = page.getByTestId('global-error-stack');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('This session is running');
  await expect(row).toHaveCount(1);

  // 提示可关闭：点 X 后消失，删除入口仍可用
  await page.getByTestId('global-error-dismiss').first().click();
  await expect(notice).toHaveCount(0);

  // 等慢速流自然结束（stop 按钮消失），再删 → 成功
  await expect(page.getByTestId('chat-stop')).toHaveCount(0, { timeout: 30_000 });
  await row.locator('.sidebar-session-menu-trigger').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });
});

test('侧栏会话列表：长列表展开与收起（含当前会话保底与归档分组）', async ({ launchElectronApp }) => {
  // 预置活跃工作区的 25 个会话
  const longWorkspace = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-long-')));
  const longName = path.basename(longWorkspace);
  const encodedLong = `--${longWorkspace.replace(/^\//, '').replace(/[\/\\:]/g, '-')}--`;
  const seedDirLong = path.join(agentDir, 'sessions', encodedLong);
  await mkdir(seedDirLong, { recursive: true });
  for (let i = 0; i < 25; i += 1) {
    const seedId = `019fe296-0000-7000-8000-${String(i).padStart(12, '0')}`;
    const seedTs = new Date(Date.parse('2026-08-01T00:00:00.000Z') + i * 60_000).toISOString();
    const lines = [
      JSON.stringify({ type: 'session', version: 3, id: seedId, timestamp: seedTs, cwd: longWorkspace }),
      JSON.stringify({
        type: 'message',
        id: `msg-${i}`,
        parentId: null,
        timestamp: seedTs,
        message: { role: 'user', content: [{ type: 'text', text: `active session ${i}` }], timestamp: Date.parse(seedTs) },
      }),
    ];
    await writeFile(path.join(seedDirLong, `${seedTs.replace(/[:.]/g, '-')}_${seedId}.jsonl`), lines.join('\n') + '\n');
  }

  // 预置归档工作区的 25 个会话
  const archivedWorkspace = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-archived-')));
  const archivedName = path.basename(archivedWorkspace);
  const encodedArchived = `--${archivedWorkspace.replace(/^\//, '').replace(/[\/\\:]/g, '-')}--`;
  const seedDirArchived = path.join(agentDir, 'sessions', encodedArchived);
  await mkdir(seedDirArchived, { recursive: true });
  for (let i = 0; i < 25; i += 1) {
    const seedId = `019fe296-0000-7000-8000-${String(100 + i).padStart(12, '0')}`;
    const seedTs = new Date(Date.parse('2026-08-02T00:00:00.000Z') + i * 60_000).toISOString();
    const lines = [
      JSON.stringify({ type: 'session', version: 3, id: seedId, timestamp: seedTs, cwd: archivedWorkspace }),
      JSON.stringify({
        type: 'message',
        id: `msg-archived-${i}`,
        parentId: null,
        timestamp: seedTs,
        message: { role: 'user', content: [{ type: 'text', text: `archived session ${i}` }], timestamp: Date.parse(seedTs) },
      }),
      JSON.stringify({
        type: 'custom',
        customType: 'pi-desktop.archive',
        data: { archived: true },
      }),
    ];
    await writeFile(path.join(seedDirArchived, `${seedTs.replace(/[:.]/g, '-')}_${seedId}.jsonl`), lines.join('\n') + '\n');
  }

  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: longWorkspace },
    });
    const page = await app.firstWindow();
    await waitSessionReady(page);

    const activeGroup = page.getByTestId(`session-group-${longName}`);
    await expect(activeGroup).toBeVisible({ timeout: 15_000 });

    // 默认展示 10 条
    const activeRows = activeGroup.locator('.sidebar-session-row');
    await expect(activeRows).toHaveCount(10);

    // 显示更多按钮可见（剩余 15 条），收起按钮不可见
    const showMoreBtn = page.getByTestId(`session-group-show-more-${longName}`);
    const showLessBtn = page.getByTestId(`session-group-show-less-${longName}`);
    await expect(showMoreBtn).toBeVisible();
    await expect(showMoreBtn).toContainText('15');
    await expect(showLessBtn).toHaveCount(0);

    // 点击一次「显示更多」→ 直接全部展开（25 条全部可见），显示更多消失，收起可见
    await showMoreBtn.click();
    await expect(activeRows).toHaveCount(25);
    await expect(showMoreBtn).toHaveCount(0);
    await expect(showLessBtn).toBeVisible();

    // 点击「收起」→ 回到 10 条，显示更多恢复，收起消失
    await showLessBtn.click();
    await expect(activeRows).toHaveCount(10);
    await expect(showMoreBtn).toBeVisible();
    await expect(showMoreBtn).toContainText('15');
    await expect(showLessBtn).toHaveCount(0);

    // 测试当前会话在第 25 条时的保底逻辑：
    // 先全部展开至 25 条，点击第 25 个会话使其成为当前活跃会话（isCurrent）
    await showMoreBtn.click();
    await expect(activeRows).toHaveCount(25);
    const lastSessionRow = activeRows.nth(24);
    await lastSessionRow.locator('.sidebar-session').click();
    await expect(lastSessionRow.locator('.sidebar-session.current')).toBeVisible();

    // 点击「收起」：因为当前会话在第 25 条，保底显示 25 条而非 10 条
    await showLessBtn.click();
    await expect(activeRows).toHaveCount(25);
    await expect(showLessBtn).toHaveCount(0);

    // 归档分组展开与收起测试
    const archivedHeader = page.getByTestId(`archived-session-group-header-${archivedName}`);
    await expect(archivedHeader).toBeVisible();
    await archivedHeader.click();

    const archivedGroup = page.getByTestId(`archived-session-group-${archivedName}`);
    const archivedRows = archivedGroup.locator('.sidebar-session-row');
    await expect(archivedRows).toHaveCount(10);

    const archivedShowMoreBtn = page.getByTestId(`archived-session-group-show-more-${archivedName}`);
    const archivedShowLessBtn = page.getByTestId(`archived-session-group-show-less-${archivedName}`);
    await expect(archivedShowMoreBtn).toBeVisible();
    await expect(archivedShowLessBtn).toHaveCount(0);

    await archivedShowMoreBtn.click();
    await expect(archivedRows).toHaveCount(25);
    await expect(archivedShowLessBtn).toBeVisible();

    await archivedShowLessBtn.click();
    await expect(archivedRows).toHaveCount(10);
    await expect(archivedShowLessBtn).toHaveCount(0);
  } finally {
    await rm(longWorkspace, { recursive: true, force: true });
    await rm(archivedWorkspace, { recursive: true, force: true });
  }
});
