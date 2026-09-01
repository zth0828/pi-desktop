// Windows/Linux frameless 自绘顶部 E2E：Row 1 标题栏（菜单 + 窗口控件）+ 侧边栏顶部
// （新会话全宽 / 折叠/搜索靠右），会话标题留在内容区顶部。
// macOS 使用原生菜单栏/标题栏，本套件全部跳过（mac 行为由既有用例覆盖）。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

test.describe('Windows frameless 标题栏', () => {
  test.skip(process.platform === 'darwin', 'macOS 使用原生菜单栏/标题栏');

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

  test.afterAll(async () => {
    mock?.kill();
    await rm(workspace, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
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

  test('Row 1 菜单栏：菜单项与窗口控件同一行 y 相等', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    const menuFileBox = await page.getByTestId('menu-file').boundingBox();
    const windowCloseBox = await page.getByTestId('window-close').boundingBox();
    expect(menuFileBox).not.toBeNull();
    expect(windowCloseBox).not.toBeNull();
    expect(menuFileBox!.y).toBe(windowCloseBox!.y);

    // 八个菜单项纵向对齐（整行菜单栏）
    for (const group of ['edit', 'selection', 'view', 'go', 'run', 'terminal', 'help']) {
      const box = await page.getByTestId(`menu-${group}`).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBe(menuFileBox!.y);
    }

    // 窗口控件固定在 Row 1 最右侧
    const titlebarBox = await page.getByTestId('titlebar').boundingBox();
    expect(titlebarBox).not.toBeNull();
    expect(windowCloseBox!.x + windowCloseBox!.width).toBeGreaterThanOrEqual(titlebarBox!.x + titlebarBox!.width - 2);
    await app.close();
  });

  test('新会话与折叠/搜索同一行：新会话占满侧边栏宽，折叠/搜索靠右；折叠时新会话隐藏', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    const sidebar = page.locator('.sidebar');
    const sidebarBox = await sidebar.boundingBox();
    const newChatBox = await page.getByTestId('new-chat').boundingBox();
    const toggleBox = await page.getByTestId('sidebar-toggle').boundingBox();
    const searchBox = await page.getByTestId('session-search-trigger').boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(newChatBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(searchBox).not.toBeNull();

    // 同一行：y 相差在按钮高度差（30px vs 36px 垂直居中）容差内
    expect(Math.abs(newChatBox!.y - toggleBox!.y)).toBeLessThan(4);
    expect(searchBox!.y).toBe(toggleBox!.y);
    // 折叠/搜索在侧边栏右半区（同行靠右）
    const sidebarCenterX = sidebarBox!.x + sidebarBox!.width / 2;
    expect(toggleBox!.x).toBeGreaterThan(sidebarCenterX);
    // 新会话按钮占满侧边栏主要宽度（含 padding/margin 容差）
    expect(newChatBox!.x - sidebarBox!.x).toBeGreaterThanOrEqual(8);
    expect(newChatBox!.x - sidebarBox!.x).toBeLessThanOrEqual(20);
    expect(Math.abs(newChatBox!.width - sidebarBox!.width)).toBeLessThan(110);

    // 标题栏位置在折叠前后不变
    const titlebarBox = await page.getByTestId('titlebar').boundingBox();
    expect(titlebarBox).not.toBeNull();

    await page.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(0);
    // 新会话在侧边栏内 → 折叠后隐藏
    await expect(page.getByTestId('new-chat')).toBeHidden();
    // 展开入口：is-native-frame 悬浮层出现在内容区左上角（标题栏之下）
    const floating = page.getByTestId('app-window-controls');
    await expect(floating).toBeVisible();
    const floatingBox = await floating.boundingBox();
    expect(floatingBox).not.toBeNull();
    expect(floatingBox!.x).toBeLessThan(60);
    expect(floatingBox!.y).toBeGreaterThanOrEqual(30);
    expect(floatingBox!.y).toBeLessThan(60);
    // 标题栏位置不变
    const collapsedTitlebarBox = await page.getByTestId('titlebar').boundingBox();
    expect(collapsedTitlebarBox).not.toBeNull();
    expect(collapsedTitlebarBox!.x).toBe(titlebarBox!.x);
    expect(collapsedTitlebarBox!.y).toBe(titlebarBox!.y);
    expect(collapsedTitlebarBox!.width).toBe(titlebarBox!.width);
    expect(collapsedTitlebarBox!.height).toBe(titlebarBox!.height);

    // 点击悬浮层展开按钮恢复
    await floating.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('new-chat')).toBeVisible();
    await app.close();
  });

  test('菜单下拉可开合，菜单文案跟随语言 zh/en 即时切换', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    // 默认 en
    await expect(page.getByTestId('menu-file')).toHaveText('File');

    // 打开文件菜单下拉
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-dropdown-file')).toBeVisible();
    await expect(page.getByTestId('menu-item-file-0')).toHaveText('New Chat');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-dropdown-file')).toHaveCount(0);

    // 打开编辑菜单下拉
    await page.getByTestId('menu-edit').click();
    await expect(page.getByTestId('menu-dropdown-edit')).toBeVisible();
    await expect(page.getByTestId('menu-item-edit-0')).toHaveText('Undo');
    await expect(page.getByTestId('menu-item-edit-1')).toHaveText('Redo');
    await expect(page.getByTestId('menu-item-edit-2')).toHaveText('Cut');
    await expect(page.getByTestId('menu-item-edit-3')).toHaveText('Copy');
    await expect(page.getByTestId('menu-item-edit-4')).toHaveText('Paste');
    await expect(page.getByTestId('menu-item-edit-5')).toHaveText('Select All');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-dropdown-edit')).toHaveCount(0);

    // 切中文：菜单文案立即切换（i18n useTranslation 驱动）
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-language')).toBeVisible();
    await page.getByTestId('lang-zh').click();
    await expect(page.getByTestId('menu-file')).toHaveText('文件');
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-dropdown-file')).toBeVisible();
    await expect(page.getByTestId('menu-item-file-0')).toHaveText('新建会话');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('menu-edit')).toHaveText('编辑');
    await page.getByTestId('menu-edit').click();
    await expect(page.getByTestId('menu-dropdown-edit')).toBeVisible();
    await expect(page.getByTestId('menu-item-edit-0')).toHaveText('撤销');
    await expect(page.getByTestId('menu-item-edit-1')).toHaveText('重做');
    await expect(page.getByTestId('menu-item-edit-2')).toHaveText('剪切');
    await expect(page.getByTestId('menu-item-edit-3')).toHaveText('复制');
    await expect(page.getByTestId('menu-item-edit-4')).toHaveText('粘贴');
    await expect(page.getByTestId('menu-item-edit-5')).toHaveText('全选');
    await page.keyboard.press('Escape');

    // 切回英文
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('menu-file')).toHaveText('File');
    await app.close();
  });

  test('窗口控件：最小化/最大化切换后窗口状态正确', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('window-maximize').click();
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized(),
    )).toBe(true);
    await page.getByTestId('window-maximize').click();
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized(),
    )).toBe(false);

    await page.getByTestId('window-minimize').click();
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized(),
    )).toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.restore();
      win.focus();
    });
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized(),
    )).toBe(false);
    await app.close();
  });

  test('DOM 关闭按钮 → win.close() → 隐藏到托盘不退出，可恢复', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    await page.getByTestId('window-close').click();

    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return wins.length === 1 && !wins[0].isDestroyed() && !wins[0].isVisible();
    })).toBe(true);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible(),
    )).toBe(true);
    await app.close();
  });
});
