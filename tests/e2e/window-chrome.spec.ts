// Windows/Linux frameless 自绘顶部（Row 1 菜单栏 + Row 2 工具行）E2E。
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

  test('两行结构：Row 1 菜单栏 y 相等，Row 2 工具行 y 相等，两组不同且 Row 1 在上', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    // Row 1：菜单项与窗口关闭按钮同一行（标题栏行）
    const menuFileBox = await page.getByTestId('menu-file').boundingBox();
    const windowCloseBox = await page.getByTestId('window-close').boundingBox();
    expect(menuFileBox).not.toBeNull();
    expect(windowCloseBox).not.toBeNull();
    expect(menuFileBox!.y).toBe(windowCloseBox!.y);

    // Row 2：新会话按钮与会话标题同一行（工具行）
    const newChatBox = await page.getByTestId('new-chat').boundingBox();
    const titlebarBox = await page.getByTestId('session-titlebar').boundingBox();
    expect(newChatBox).not.toBeNull();
    expect(titlebarBox).not.toBeNull();
    expect(newChatBox!.y).toBe(titlebarBox!.y);

    // 两组不同：Row 1 在 Row 2 之上
    expect(menuFileBox!.y).toBeLessThan(newChatBox!.y);

    // Row 1 是整行菜单栏：八个菜单项纵向对齐
    for (const group of ['edit', 'selection', 'view', 'go', 'run', 'terminal', 'help']) {
      const box = await page.getByTestId(`menu-${group}`).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBe(menuFileBox!.y);
    }
    await app.close();
  });

  test('侧栏折叠前后 titlebar/toolbar 位置不变（通栏固定）', async ({ launchElectronApp }) => {
    const app = await launchElectronApp(launchOptions());
    const page = await app.firstWindow();
    await waitSessionReady(page);

    const titlebarBox = await page.getByTestId('titlebar').boundingBox();
    const toolbarBox = await page.getByTestId('toolbar').boundingBox();
    expect(titlebarBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();

    await page.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await page.locator('.sidebar').boundingBox())?.width).toBe(0);

    const collapsedTitlebarBox = await page.getByTestId('titlebar').boundingBox();
    const collapsedToolbarBox = await page.getByTestId('toolbar').boundingBox();
    expect(collapsedTitlebarBox).not.toBeNull();
    expect(collapsedToolbarBox).not.toBeNull();
    expect(collapsedTitlebarBox!.x).toBe(titlebarBox!.x);
    expect(collapsedTitlebarBox!.y).toBe(titlebarBox!.y);
    expect(collapsedTitlebarBox!.width).toBe(titlebarBox!.width);
    expect(collapsedTitlebarBox!.height).toBe(titlebarBox!.height);
    expect(collapsedToolbarBox!.x).toBe(toolbarBox!.x);
    expect(collapsedToolbarBox!.y).toBe(toolbarBox!.y);
    expect(collapsedToolbarBox!.width).toBe(toolbarBox!.width);
    expect(collapsedToolbarBox!.height).toBe(toolbarBox!.height);

    // 工具行内控件仍在原位
    const newChatBox = await page.getByTestId('new-chat').boundingBox();
    expect(newChatBox).not.toBeNull();
    expect(newChatBox!.x).toBeGreaterThan(0);
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

    // 切中文：菜单文案立即切换（i18n useTranslation 驱动）
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-language')).toBeVisible();
    await page.getByTestId('lang-zh').click();
    await expect(page.getByTestId('menu-file')).toHaveText('文件');
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-dropdown-file')).toBeVisible();
    await expect(page.getByTestId('menu-item-file-0')).toHaveText('新建会话');
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

    // 最大化 → 还原
    await page.getByTestId('window-maximize').click();
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized(),
    )).toBe(true);
    await page.getByTestId('window-maximize').click();
    await expect.poll(async () => app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized(),
    )).toBe(false);

    // 最小化 → 恢复（恢复后才能正常收尾关闭）
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

    // 应用未退出：主窗口 hide（未销毁、不可见）——复用 close→hide 到托盘语义
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return wins.length === 1 && !wins[0].isDestroyed() && !wins[0].isVisible();
    })).toBe(true);

    // 恢复（托盘点击路径）：show + focus 后窗口可见
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
