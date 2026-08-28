import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let server: http.Server;
let serverPort: number;
let agentDir: string;

const dummyBinary = Buffer.from('pi-desktop-test-installer-binary');
const binaryHash = createHash('sha256').update(dummyBinary).digest('hex');

test.beforeAll(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-version-update-'));
  await writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({ providers: {} }),
  );

  server = http.createServer((req, res) => {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const assetName = process.platform === 'darwin'
      ? `Pi.Desktop-9.9.9-${arch}.dmg`
      : process.platform === 'win32'
        ? `Pi.Desktop-Setup-9.9.9-${arch}.exe`
        : `Pi.Desktop-9.9.9-x86_64.AppImage`;

    const platformName = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
    const sumsName = `SHA256SUMS-${platformName}.txt`;

    if (req.url?.startsWith('/releases/latest')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tag_name: 'v9.9.9',
        draft: false,
        prerelease: false,
        html_url: 'https://github.com/zth0828/pi-desktop/releases/tag/v9.9.9',
        body: '✨ Enhanced update cards and metrics\n🐛 Bug fix for path resolution',
        assets: [
          {
            name: assetName,
            browser_download_url: `http://127.0.0.1:${serverPort}/download/asset`,
          },
          {
            name: sumsName,
            browser_download_url: `http://127.0.0.1:${serverPort}/download/sums`,
          },
        ],
      }));
      return;
    }

    if (req.url === '/download/asset') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(dummyBinary.length),
      });
      res.end(dummyBinary);
      return;
    }

    if (req.url === '/download/sums') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${binaryHash}  ${assetName}\n`);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') serverPort = addr.port;
      resolve();
    });
  });
});

test.afterAll(async () => {
  server?.close();
  await rm(agentDir, { recursive: true, force: true });
});

test('版本更新提醒：发现新版本弹出 Toast，关闭后重启不重复弹出', async ({
  launchElectronApp,
  homeDir,
}) => {
  const githubApiUrl = `http://127.0.0.1:${serverPort}/releases/latest`;
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    githubApiUrl,
  });
  const page = await app.firstWindow();

  // 1. Toast 出现
  const toast = page.getByTestId('version-update-toast');
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('version-update-body')).toContainText('9.9.9');

  // 2. 点击关闭 Toast
  await page.getByTestId('version-update-dismiss').click();
  await expect(toast).toHaveCount(0);

  // 3. 验证 electron-store 已记录已提醒版本
  const configPath = path.join(homeDir, 'user-data', 'config.json');
  await expect.poll(async () => {
    try {
      const config = JSON.parse(await readFile(configPath, 'utf8')) as { appVersionCheckNoticedLatest?: string };
      return config.appVersionCheckNoticedLatest;
    } catch {
      return undefined;
    }
  }, { timeout: 10_000 }).toBe('v9.9.9');

  // 4. 重启应用：同一版本不再重复弹窗
  await app.close();
  const restartedApp = await launchElectronApp({
    withPi: true,
    agentDir,
    githubApiUrl,
  });
  const restartedPage = await restartedApp.firstWindow();
  await restartedPage.waitForTimeout(2_000);
  await expect(restartedPage.getByTestId('version-update-toast')).toHaveCount(0);
});

test('设置页：下载更新后弹出安装引导对话框，稍后关闭后常驻设置页', async ({
  launchElectronApp,
}) => {
  const githubApiUrl = `http://127.0.0.1:${serverPort}/releases/latest`;
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    initialPage: 'settings',
    githubApiUrl,
  });
  const page = await app.firstWindow();

  // 触发版本检查与下载
  await page.getByTestId('settings-app-check').click();
  const downloadBtn = page.getByTestId('settings-app-download');
  await expect(downloadBtn).toBeVisible({ timeout: 15_000 });

  // 验证 Release Notes 更新内容已展示
  await expect(page.locator('.settings-changelog-text')).toContainText('Enhanced update cards');

  await downloadBtn.click();

  // 下载完成后弹出全局模态引导对话框
  const dialog = page.getByTestId('version-install-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // 点击稍后，关闭弹窗
  await page.getByTestId('version-install-later').click();
  await expect(dialog).toHaveCount(0);

  // 设置页常驻展示已下载状态和操作按钮
  await expect(page.getByTestId('settings-app-downloaded-status')).toBeVisible();
  await expect(page.getByTestId('settings-app-install')).toBeVisible();
  await expect(page.getByTestId('settings-app-open')).toBeVisible();
  await expect(page.getByTestId('settings-app-show')).toBeVisible();
});

test('设置页：镜像加速配置修改与落盘', async ({
  launchElectronApp,
  homeDir,
}) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    initialPage: 'settings',
  });
  const page = await app.firstWindow();

  const mirrorInput = page.getByTestId('settings-download-mirror');
  await expect(mirrorInput).toBeVisible({ timeout: 15_000 });
  await mirrorInput.fill('https://ghproxy.net/');
  await mirrorInput.evaluate((el) => el.dispatchEvent(new Event('change')));

  const configPath = path.join(homeDir, 'user-data', 'config.json');
  await expect.poll(async () => {
    try {
      const config = JSON.parse(await readFile(configPath, 'utf8')) as { downloadMirror?: string };
      return config.downloadMirror;
    } catch {
      return undefined;
    }
  }, { timeout: 10_000 }).toBe('https://ghproxy.net/');
});
