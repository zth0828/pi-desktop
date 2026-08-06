// M5 验收：Extensions 页 —— piPackages（SDK PackageManager）列表/安装/卸载。
// 不烧网络：list 用预写 settings.json 的 packages 数组；安装/卸载用本地目录扩展。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let agentDir: string;
let extDir: string;

test.beforeAll(async () => {
  // 本地目录扩展（pi 扩展约定：目录里 default export 的 .ts 入口）
  extDir = path.join(await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-')), 'local-ext');
  await mkdir(extDir, { recursive: true });
  await writeFile(path.join(extDir, 'index.ts'), 'export default function (pi) {}\n');
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

test.afterAll(async () => {
  await rm(path.dirname(extDir), { recursive: true, force: true });
});

test('Extensions 页：settings.json 里配置的 npm 扩展出现在列表', async ({ launchElectronApp }) => {
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ packages: ['npm:pi-mcp-adapter'] }),
  );
  // 不 seed workspaceCwd：不起 runtime，避免 resourceLoader 去网络解析缺失的包
  const app = await launchElectronApp({ withPi: true, agentDir });
  const page = await app.firstWindow();

  await page.getByTestId('nav-extensions').click();
  const row = page.getByTestId('package-row-pi-mcp-adapter');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('npm:pi-mcp-adapter');
});

test('Extensions 页：本地目录扩展安装 → 列表出现 → 卸载消失', async ({ launchElectronApp }) => {
  await writeFile(path.join(agentDir, 'settings.json'), '{}');
  const app = await launchElectronApp({ withPi: true, agentDir });
  const page = await app.firstWindow();

  await page.getByTestId('nav-extensions').click();
  await expect(page.getByTestId('packages-empty')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('package-install-input').fill(extDir);
  await page.getByTestId('package-install').click();
  const row = page.getByTestId('package-row-local-ext');
  await expect(row).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('package-remove-local-ext').click();
  await expect(row).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('packages-empty')).toBeVisible();
});
