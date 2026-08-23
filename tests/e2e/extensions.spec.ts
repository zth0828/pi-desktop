// Packages 页 E2E：官方目录发现 + piPackages（SDK PackageManager）安装/卸载。
// 不访问公网：目录与 npm registry 都由本地 fixture server 提供。
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './fixtures/electron';

let agentDir: string;
let extDir: string;
let fixtureRoot: string;
let catalogServer: ChildProcess;
let catalogUrl: string;

const execFileAsync = promisify(execFile);

test.beforeAll(async () => {
  // 本地目录扩展（pi 扩展约定：目录里 default export 的 .ts 入口）
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-'));
  extDir = path.join(fixtureRoot, 'local-ext');
  await mkdir(extDir, { recursive: true });
  await writeFile(path.join(extDir, 'index.ts'), 'export default function (pi) {}\n');
  await writeFile(
    path.join(extDir, 'package.json'),
    JSON.stringify({
      name: 'pi-desktop-catalog-fixture',
      version: '1.0.0',
      pi: { extensions: ['index.ts'] },
    }),
  );
  // Windows 上 npm 是 .cmd shim，execFile 不经 shell 无法执行
  await execFileAsync('npm', ['pack', '--silent', '--pack-destination', fixtureRoot], {
    cwd: extDir,
    shell: process.platform === 'win32',
  });
  const tarballName = (await readdir(fixtureRoot)).find((name) => name.endsWith('.tgz'));
  if (!tarballName) throw new Error('catalog fixture tarball not created');
  catalogServer = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-package-catalog-server.mjs'),
    path.join(fixtureRoot, tarballName),
  ]);
  catalogUrl = await new Promise<string>((resolveUrl, reject) => {
    catalogServer.stdout?.on('data', (data) => {
      const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolveUrl(match[0]);
    });
    setTimeout(() => reject(new Error('package catalog mock server timeout')), 10_000);
  });
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
});

test.afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

test.afterAll(async () => {
  catalogServer?.kill();
  await rm(fixtureRoot, { recursive: true, force: true });
});

const launchOptions = () => ({
  withPi: true,
  agentDir,
  packageCatalogUrl: `${catalogUrl}/packages`,
  npmRegistryUrl: `${catalogUrl}/`,
});

test('Extensions 页：settings.json 里配置的 npm 扩展出现在列表', async ({ launchElectronApp }) => {
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ packages: ['npm:pi-mcp-adapter'] }),
  );
  // 不 seed workspaceCwd：不起 runtime，避免 resourceLoader 去网络解析缺失的包。
  // 等侧边栏出现即可（onboarding 完成，无需 runtime/模型徽标）。
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await expect(page.getByTestId('nav-chat')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('nav-extensions').click();
  await page.getByTestId('extensions-tab-installed').click();
  const row = page.getByTestId('package-row-pi-mcp-adapter');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('npm:pi-mcp-adapter');
});

test('Packages 页：目录搜索/筛选 → npm 安装 → 已安装管理 → 卸载', async ({ launchElectronApp }) => {
  await writeFile(path.join(agentDir, 'settings.json'), '{}');
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-extensions').click();
  const catalogPackage = page.getByTestId('catalog-package-pi-desktop-catalog-fixture');
  await expect(catalogPackage).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('catalog-count')).toContainText('3 packages');
  await page.getByTestId('catalog-next').click();
  await expect(page.getByTestId('catalog-package-pi-desktop-theme-fixture')).toBeVisible();
  await page.getByTestId('catalog-previous').click();
  await expect(catalogPackage).toBeVisible();

  await page.getByTestId('catalog-type-filter').selectOption('skill');
  await expect(page.getByTestId('catalog-package-pi-desktop-skill-fixture')).toBeVisible();
  await expect(catalogPackage).not.toBeVisible();
  await page.getByTestId('catalog-type-filter').selectOption('');
  await page.getByTestId('catalog-search-input').fill('installable');
  await page.getByTestId('catalog-search').click();
  await expect(page.getByTestId('catalog-count')).toContainText('1 packages');
  await expect(catalogPackage).toBeVisible();

  await page.getByTestId('catalog-install-pi-desktop-catalog-fixture').click();
  await expect(page.getByTestId('catalog-manage-pi-desktop-catalog-fixture')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('catalog-manage-pi-desktop-catalog-fixture').click();
  const installedRow = page.getByTestId('package-row-pi-desktop-catalog-fixture');
  await expect(installedRow).toBeVisible();
  await expect(installedRow).toContainText('v1.0.0');
  await page.getByTestId('package-remove-pi-desktop-catalog-fixture').click();
  await expect(installedRow).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('packages-empty')).toBeVisible();
});

test('Packages 页：高级 source 安装保留本地目录能力', async ({ launchElectronApp }) => {
  await writeFile(path.join(agentDir, 'settings.json'), '{}');
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-extensions').click();
  await page.getByTestId('extensions-tab-installed').click();
  await expect(page.getByTestId('packages-empty')).toBeVisible({ timeout: 15_000 });

  await page.locator('.advanced-package-install summary').click();
  await page.getByTestId('package-install-input').fill(extDir);
  await page.getByTestId('package-install').click();
  const row = page.getByTestId('package-row-local-ext');
  await expect(row).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('package-remove-local-ext').click();
  await expect(row).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('packages-empty')).toBeVisible();
});

test('Packages 页：详情在应用内渲染元数据、manifest 与 README', async ({ launchElectronApp }) => {
  await writeFile(path.join(agentDir, 'settings.json'), '{}');
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();

  await page.getByTestId('nav-extensions').click();
  await expect(page.getByTestId('catalog-package-pi-desktop-catalog-fixture')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('catalog-details-pi-desktop-catalog-fixture').click();

  const detail = page.getByTestId('package-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.package-detail-hero h3')).toHaveText('pi-desktop-catalog-fixture');
  await expect(detail.getByText('Fixture README with')).toBeVisible();
  await expect(detail.getByText('Pi manifest JSON')).toBeVisible();
  await expect(page.getByTestId('package-cache-status')).toContainText('Cached');

  await page.getByTestId('package-detail-refresh').click();
  await expect(page.getByTestId('package-detail')).toBeVisible();
  await page.getByTestId('package-detail-back').click();
  await expect(page.getByTestId('package-catalog')).toBeVisible();
});
