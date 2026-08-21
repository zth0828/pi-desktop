// macOS 原生系统菜单栏 E2E（dev/打包产物行为一致）：
//   - 应用菜单标题为 Pi Desktop（dev 下 electron 直接启动默认为 Electron）
//   - 业务菜单（New Chat / Collapse Sidebar / Search Chats）存在
//   - 点击菜单项能驱动 renderer 业务动作（折叠/展开侧边栏）
// Windows/Linux 使用自绘标题栏内菜单栏，本套件全部跳过。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-menu-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-menu-workspace-'));
  await writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          apiKey: 'mock-key',
          models: [
            { id: 'mock-1', name: 'Mock 1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
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
  await rm(workspace, { recursive: true, force: true });
});

/** 主进程侧收集应用菜单的全部 label（含子菜单），用于断言结构与业务项。 */
function collectMenuLabels() {
  return (main: { Menu: typeof import('electron').Menu }): (string | null)[] => {
    const menu = main.Menu.getApplicationMenu();
    if (!menu) return [];
    const walk = (items: import('electron').MenuItem[]): (string | null)[] =>
      items.flatMap((item) => [
        item.label,
        ...(item.submenu ? walk(item.submenu.items) : []),
      ]);
    return walk(menu.items);
  };
}

/** 主进程侧按 label 找到菜单项并触发其 click（等价真实点击系统菜单）。
    返回的函数接收 (main, label)：Playwright evaluate 的第二个参数传入，避免闭包丢失。 */
function clickMenuLabel() {
  return (main: { Menu: typeof import('electron').Menu }, label: string): boolean => {
    const menu = main.Menu.getApplicationMenu();
    if (!menu) return false;
    const find = (items: import('electron').MenuItem[]): import('electron').MenuItem | null => {
      for (const item of items) {
        if (item.label === label) return item;
        const found = item.submenu ? find(item.submenu.items) : null;
        if (found) return found;
      }
      return null;
    };
    const item = find(menu.items);
    if (!item || typeof item.click !== 'function') return false;
    item.click();
    return true;
  };
}

test.describe('macOS 原生系统菜单栏', () => {
  test.skip(process.platform !== 'darwin', '原生菜单栏仅 macOS');

  test('应用菜单显示 Pi Desktop 与业务菜单；点击折叠/搜索驱动 renderer', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });

    // dev 下 electron 直接启动 app.name 默认为 Electron；必须显示 Pi Desktop
    const labels = await app.evaluate(collectMenuLabels());
    const joined = labels.filter(Boolean).join(' | ');
    expect(joined).toContain('Pi Desktop');
    // 菜单文案跟随系统语言（role 项由 macOS 本地化；业务项我们按 locale 渲染）
    const locale = await app.evaluate(({ app: mainApp }) => mainApp.getLocale());
    const zh = locale.toLowerCase().startsWith('zh');
    const fileMenu = zh ? '文件' : 'File';
    const viewMenu = zh ? '视图' : 'View';
    const newChat = zh ? '新建会话' : 'New Chat';
    const collapseSidebar = zh ? '折叠侧边栏' : 'Collapse Sidebar';
    const searchChats = zh ? '搜索会话' : 'Search Chats';
    expect(labels).toContain(fileMenu);
    expect(labels).toContain(viewMenu);
    expect(joined).toContain(newChat);
    expect(joined).toContain(collapseSidebar);
    expect(joined).toContain(searchChats);

    const sidebar = page.locator('.sidebar');
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeGreaterThan(0);

    // Collapse Sidebar → 侧栏收起（label 随 locale，用与上面一致的变量）
    expect(await app.evaluate(clickMenuLabel(), collapseSidebar)).toBe(true);
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(0);
    // 再点一次 → 展开
    expect(await app.evaluate(clickMenuLabel(), collapseSidebar)).toBe(true);
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeGreaterThan(100);
    await app.close();
  });
});
