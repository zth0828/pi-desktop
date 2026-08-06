// M5 验收：MCP 页 —— mcpServers 配置 CRUD（<agentDir>/mcp.json，global scope）。
// 不起 runtime（不 seed workspaceCwd）：配置 CRUD 不依赖会话；adapter 未装 → 显示安装引导。
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
