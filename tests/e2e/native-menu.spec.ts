// macOS 原生系统菜单栏 E2E（dev/打包产物行为一致）：
//   - 结构与 Windows/Linux 自绘菜单栏一致（八组 + 同样菜单项），应用菜单显示 Pi Desktop
//   - 菜单文案跟随应用语言设置（seedSettings.language），而非系统 locale
//     （fixture 强制 --lang=en-US，seed zh 仍应显示中文，验证不再中英混杂）
//   - 点击菜单项能驱动 renderer 业务动作（折叠/展开侧边栏）
//   - 切换语言后原生菜单即时重建为对应文案
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

  test('菜单结构与 Windows 自绘菜单一致；文案跟随应用语言而非系统 locale', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      // fixture 启动带 --lang=en-US（系统 locale 为英文）；seed zh 应仍显示中文
      seedSettings: { workspaceCwd: workspace, language: 'zh' },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });

    // dev 下 electron 直接启动 app.name 默认为 Electron；必须显示 Pi Desktop
    const labels = await app.evaluate(collectMenuLabels());
    const joined = labels.filter(Boolean).join(' | ');
    expect(joined).toContain('Pi Desktop');

    // 八组菜单与 Windows 自绘菜单一致（含应用菜单共九个顶层项）
    for (const group of ['文件', '编辑', '选择', '查看', '转到', '运行', '终端', '帮助']) {
      expect(labels).toContain(group);
    }
    // 菜单项与 Windows 自绘菜单一致
    for (const item of ['新建会话', '关闭窗口', '撤销', '重做', '剪切', '复制', '粘贴', '全选', '折叠侧边栏', '会话搜索', '敬请期待']) {
      expect(joined).toContain(item);
    }
    // 语言跟随应用设置：系统 locale 为英文时也不应出现 role 项自动本地化的英文
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Window');

    const sidebar = page.locator('.sidebar');
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeGreaterThan(0);

    // Collapse Sidebar → 侧栏收起；再点一次 → 展开
    expect(await app.evaluate(clickMenuLabel(), '折叠侧边栏')).toBe(true);
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(0);
    expect(await app.evaluate(clickMenuLabel(), '折叠侧边栏')).toBe(true);
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeGreaterThan(100);
    await app.close();
  });

  test('Cmd+A 通过原生编辑菜单全选输入框内容（selectAll role）', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace, language: 'zh' },
    });
    const page = await app.firstWindow();

    // 菜单里必须有全选项：没有 selectAll role 时 macOS 上 Cmd+A 不会落到输入框
    const labels = await app.evaluate(collectMenuLabels());
    expect(labels.filter(Boolean)).toContain('全选');

    await page.getByTestId('nav-models').click();
    await page.getByTestId('add-custom-provider').click();
    const form = page.getByTestId('custom-provider-form');
    const input = form.getByPlaceholder('baseURL');
    await input.fill('http://127.0.0.1:9/v1');
    await input.click();
    await page.keyboard.press('Meta+A');
    await expect.poll(async () =>
      page.evaluate(() => {
        const doc = (globalThis as unknown as {
          document: { activeElement: { selectionStart: number | null; selectionEnd: number | null; value: string } | null };
        }).document;
        const el = doc.activeElement;
        return el ? { start: el.selectionStart, end: el.selectionEnd, len: el.value.length } : null;
      }),
    ).toEqual({ start: 0, end: 21, len: 21 });
    await app.close();
  });

  test('渲染层切换语言后原生菜单即时重建为对应文案', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace, language: 'zh' },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });

    // 与 Settings 页 changeLanguage 同一条链路：settings.set('language', ...)
    const changed = await page.evaluate(async () => {
      const bridge = (globalThis as unknown as {
        pidesktop: { hostInvoke: (request: unknown) => Promise<{ ok: boolean }> };
      }).pidesktop;
      const response = await bridge.hostInvoke({
        id: 'e2e-set-language',
        module: 'settings',
        action: 'set',
        payload: { key: 'language', value: 'en' },
      });
      return response.ok;
    });
    expect(changed).toBe(true);

    const labels = await app.evaluate(collectMenuLabels());
    const joined = labels.filter(Boolean).join(' | ');
    expect(joined).toContain('Pi Desktop');
    for (const group of ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']) {
      expect(labels).toContain(group);
    }
    for (const item of ['New Chat', 'Close Window', 'Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All', 'Collapse Sidebar', 'Search Chats', 'Coming soon']) {
      expect(joined).toContain(item);
    }
    await app.close();
  });

  test('Cmd+Z / Cmd+Shift+Z / Cmd+X 编辑快捷键在输入框中正常工作', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace, language: 'zh' },
    });
    const page = await app.firstWindow();

    const input = page.getByTestId('chat-input');
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.click();
    await input.fill('');

    await page.keyboard.type('Hello World');
    await expect(input).toHaveValue('Hello World');

    // Cmd+A 全选，Cmd+X 剪切
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Meta+X');
    await expect(input).toHaveValue('');

    // Cmd+V 粘贴
    await page.keyboard.press('Meta+V');
    await expect(input).toHaveValue('Hello World');

    // Cmd+Z 撤销
    await page.keyboard.press('Meta+Z');
    await expect(input).toHaveValue('');

    // Cmd+Shift+Z 重做
    await page.keyboard.press('Meta+Shift+Z');
    await expect(input).toHaveValue('Hello World');

    await app.close();
  });
});
