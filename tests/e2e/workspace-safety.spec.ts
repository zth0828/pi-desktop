// 工作区安全 E2E：主目录/盘符根不能作为工作区（设置与启动恢复都拦），
// 删除会话后空的会话目录被清理。真 pi + mock provider，不烧 API quota。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
  await rm(agentDir, { recursive: true, force: true });
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
});

const launchOptions = (seedCwd: string) => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: seedCwd },
});

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

test('主目录作为工作区：启动恢复被拒，显示安全提示且不进会话', async ({ launchElectronApp, homeDir }) => {
  // fixture 隔离了进程 HOME（homeDir）：用它对等模拟「用户选择自己的主目录」
  const app = await launchElectronApp(launchOptions(homeDir));
  const page = await app.firstWindow();
  // 启动恢复 workspaceCwd=home → main 拒绝 → error-banner 显示翻译后的文案
  await expect(page.locator('.error-banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.error-banner')).toContainText('cannot be used as a workspace');
  // runtime 未启动：模型徽标不出现
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toHaveCount(0, { timeout: 8_000 });
});

test('settings.set 拒绝把主目录存为工作区（正常目录不受影响）', async ({ launchElectronApp, homeDir }) => {
  const app = await launchElectronApp(launchOptions(workspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  const invoke = (payload: unknown) => page.evaluate((p) => (
    globalThis as unknown as {
      pidesktop: { hostInvoke: (req: unknown) => Promise<unknown> };
    }
  ).pidesktop.hostInvoke(p), payload);

  const rejected = await invoke({
    id: 'e2e-ws-home',
    module: 'settings',
    action: 'set',
    payload: { key: 'workspaceCwd', value: homeDir },
  });
  expect(rejected).toMatchObject({ ok: true, data: { success: false, error: 'risky-workspace-home' } });

  const accepted = await invoke({
    id: 'e2e-ws-ok',
    module: 'settings',
    action: 'set',
    payload: { key: 'workspaceCwd', value: workspace },
  });
  expect(accepted).toMatchObject({ ok: true, data: { success: true } });
});

test('删除跨项目最后一个会话 → 空的会话目录被清理', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions(workspace));
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 构造另一个项目（无 runtime 持有）的孤儿会话，目录编码与 pi getDefaultSessionDir 一致
  const otherCwd = path.join(workspace, 'other-project');
  const encoded = `--${otherCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  const otherDir = path.join(agentDir, 'sessions', encoded);
  await mkdir(otherDir, { recursive: true });
  await writeFile(
    path.join(otherDir, 'orphan.jsonl'),
    [
      JSON.stringify({ type: 'session', version: 3, id: 'orphan-001', timestamp: '2026-08-21T00:00:00.000Z', cwd: otherCwd }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: '2026-08-21T00:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'orphan project session' }] } }),
      '',
    ].join('\n'),
  );

  await page.getByTestId('nav-sessions').click();
  const row = page.locator('[data-testid^="session-row-"]').filter({ hasText: 'orphan project session' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await row.getByTestId('session-delete').click();
  await row.getByTestId('session-delete-confirm').click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  // 目录里没有其它文件 → 空目录被清理
  await expect(stat(otherDir)).rejects.toThrow();
});
