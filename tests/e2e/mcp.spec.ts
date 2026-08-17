// MCP 页 —— mcpServers 配置 CRUD（<agentDir>/mcp.json，global scope）。
// 首个 spec 不起 runtime（不 seed workspaceCwd）：配置 CRUD 不依赖会话；adapter 未装 → 显示安装引导。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let agentDir: string;

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  await writeFile(path.join(agentDir, 'settings.json'), '{}');
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

const mcpJson = async () =>
  JSON.parse(await readFile(path.join(agentDir, 'mcp.json'), 'utf8')) as {
    mcpServers?: Record<string, Record<string, unknown>>;
  };

test('MCP 页：stdio server 新增 → 禁用 → 启用 → 删除（写回 mcp.json）', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp({ withPi: true, agentDir });
  const page = await app.firstWindow();

  await page.getByTestId('nav-mcp').click();
  // 未装 pi-mcp-adapter → 安装引导可见
  await expect(page.getByTestId('mcp-no-adapter')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('mcp-empty')).toBeVisible();

  // 新增 stdio server
  await page.getByTestId('mcp-add-server').click();
  await page.getByTestId('mcp-form-name').fill('mock-mcp');
  await page.getByTestId('mcp-form-command').fill('node');
  await page
    .getByTestId('mcp-form-args')
    .fill(path.join(process.cwd(), 'tests/fixtures/mock-mcp-server.mjs'));
  await page.getByTestId('mcp-form-save').click();

  const row = page.getByTestId('mcp-server-mock-mcp');
  await expect(row).toBeVisible({ timeout: 15_000 });
  // 写回 <agentDir>/mcp.json
  const written = await mcpJson();
  expect(written.mcpServers?.['mock-mcp']?.command).toBe('node');
  expect(written.mcpServers?.['mock-mcp']?.args).toEqual([
    path.join(process.cwd(), 'tests/fixtures/mock-mcp-server.mjs'),
  ]);

  // 禁用 → 文件里 disabled: true
  await page.getByTestId('mcp-disable-mock-mcp').click();
  await expect(page.getByTestId('mcp-disabled-badge-mock-mcp')).toBeVisible({ timeout: 15_000 });
  expect((await mcpJson()).mcpServers?.['mock-mcp']?.disabled).toBe(true);

  // 启用 → disabled 字段移除
  await page.getByTestId('mcp-enable-mock-mcp').click();
  await expect(page.getByTestId('mcp-disabled-badge-mock-mcp')).not.toBeVisible({ timeout: 15_000 });
  expect((await mcpJson()).mcpServers?.['mock-mcp']?.disabled).toBeUndefined();

  // 删除（需确认）→ 列表与文件都清空
  await page.getByTestId('mcp-delete-mock-mcp').click();
  await page.getByTestId('mcp-delete-confirm-mock-mcp').click();
  await expect(row).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('mcp-empty')).toBeVisible();
  expect(Object.keys((await mcpJson()).mcpServers ?? {})).toHaveLength(0);
});

test('MCP 改动后提示可重载，「立即重载」调 piRuntime.reload', async ({ launchElectronApp }) => {
  // reload 需要活动 runtime：起 mock provider + 工作区让会话就绪
  const mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  const mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock timeout')), 10_000);
  });
  const workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
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
  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('nav-mcp').click();
    await page.getByTestId('mcp-add-server').click();
    await page.getByTestId('mcp-form-name').fill('reload-mcp');
    await page.getByTestId('mcp-form-command').fill('node');
    await page.getByTestId('mcp-form-save').click();
    await expect(page.getByTestId('mcp-server-reload-mcp')).toBeVisible({ timeout: 15_000 });

    // 改动后出现重载提示；点击「立即重载」后消失
    const banner = page.getByTestId('mcp-reload-banner');
    await expect(banner).toBeVisible();
    await page.getByTestId('mcp-reload-now').click();
    await expect(banner).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('mcp-error')).toHaveCount(0);
    // 重载后列表仍在
    await expect(page.getByTestId('mcp-server-reload-mcp')).toBeVisible();
  } finally {
    mock.kill();
    await rm(workspace, { recursive: true, force: true });
  }
});
