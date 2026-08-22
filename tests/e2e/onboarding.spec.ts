// onboarding 五场景 E2E。
// 通过 PI_DESKTOP_USER_PATH / PI_DESKTOP_NPM_ROOT 测试钩子隔离模拟各环境。
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

const isWin = process.platform === 'win32';
// Windows 的 PATH 用 `;` 分隔；模拟「无系统命令可用」给空串即可
const SYSTEM_BINS = isWin ? '' : '/usr/bin:/bin';
const nodeBinDir = path.dirname(process.execPath);
const joinPath = (...parts: string[]) => parts.filter(Boolean).join(path.delimiter);

async function makeFakeNodeBin(version: string): Promise<{ binDir: string; cleanup: () => Promise<void> }> {
  const binDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-node-'));
  if (isWin) {
    // Windows 无 shebang/可执行位，检测器通过 .cmd shim 找 node
    await writeFile(path.join(binDir, 'node.cmd'), `@echo v${version}\r\n`);
  } else {
    const nodePath = path.join(binDir, 'node');
    await writeFile(nodePath, `#!/bin/sh\nprintf 'v${version}\\n'\n`);
    await chmod(nodePath, 0o755);
  }
  return { binDir, cleanup: () => rm(binDir, { recursive: true, force: true }) };
}

/** 造一个假的 npm 全局 prefix，平台布局与真实 npm 一致：
 *  POSIX：<root>/bin/pi → lib/node_modules/.../dist/cli.js（symlink）
 *  Windows：<root>/pi.cmd + <root>/node_modules/...（.cmd shim，无 symlink） */
async function makeFakeNpmPrefix(version: string): Promise<{ prefix: string; npmRoot: string; cleanup: () => Promise<void> }> {
  const prefix = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-prefix-'));
  const pkgSubPath = '@earendil-works/pi-coding-agent';
  if (isWin) {
    const pkgDir = path.join(prefix, 'node_modules', ...pkgSubPath.split('/'));
    await mkdir(path.join(pkgDir, 'dist'), { recursive: true });
    const installedPiRoot = await realpath(path.resolve('node_modules/@earendil-works/pi-coding-agent'));
    await writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version,
        main: 'dist/index.js',
        exports: { '.': { import: 'dist/index.js' } },
      }),
    );
    await symlink(path.join(installedPiRoot, 'dist/index.js'), path.join(pkgDir, 'dist/index.js'));
    await writeFile(path.join(pkgDir, 'dist/cli.js'), '#!/usr/bin/env node\n');
    await writeFile(path.join(prefix, 'pi.cmd'), '@echo off\r\necho pi (fake)\r\n');
    const npmRoot = await realpath(path.join(prefix, 'node_modules'));
    return { prefix, npmRoot, cleanup: () => rm(prefix, { recursive: true, force: true }) };
  }
  const pkgDir = path.join(prefix, 'lib/node_modules', ...pkgSubPath.split('/'));
  await mkdir(path.join(pkgDir, 'dist'), { recursive: true });
  await mkdir(path.join(prefix, 'bin'), { recursive: true });
  const installedPiRoot = await realpath(path.resolve('node_modules/@earendil-works/pi-coding-agent'));
  await writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@earendil-works/pi-coding-agent',
      version,
      main: 'dist/index.js',
      exports: { '.': { import: 'dist/index.js' } },
    }),
  );
  // Keep the detector's fake version/layout while using the real SDK entry for
  // the compatibility probe; the onboarding test must not silently skip SDK checks.
  await symlink(path.join(installedPiRoot, 'dist/index.js'), path.join(pkgDir, 'dist/index.js'));
  await writeFile(path.join(pkgDir, 'dist/cli.js'), '#!/usr/bin/env node\n');
  await symlink(path.join(pkgDir, 'dist/cli.js'), path.join(prefix, 'bin/pi'));
  const npmRoot = await realpath(path.join(prefix, 'lib/node_modules'));
  return { prefix, npmRoot, cleanup: () => rm(prefix, { recursive: true, force: true }) };
}

test('场景1：无 Node → Node 引导页', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ userPath: SYSTEM_BINS });
  const page = await app.firstWindow();
  // 拖拽层只存在于 macOS 无框标题栏
  if (process.platform === 'darwin') {
    await expect(page.getByTestId('window-drag-strip')).toHaveCSS('-webkit-app-region', 'drag');
  }
  await expect(page.getByRole('heading', { name: 'Node.js is required' })).toBeVisible();
});

test('场景1b：Node 版本达标但无 npm → 显示 npm 检测错误', async ({ launchElectronApp }) => {
  const fake = await makeFakeNodeBin('24.19.0');
  try {
    const app = await launchElectronApp({ userPath: joinPath(fake.binDir, SYSTEM_BINS) });
    const page = await app.firstWindow();
    await expect(page.getByText(/Detected Node\.js v24\.19\.0, but npm/)).toBeVisible();
    await expect(page.getByText(/below the required/)).toHaveCount(0);
  } finally {
    await fake.cleanup();
  }
});

test('场景2：有 Node 无 pi → 安装引导页', async ({ launchElectronApp }) => {
  const npmRoot = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-empty-root-'));
  try {
    const app = await launchElectronApp({
      userPath: joinPath(nodeBinDir, SYSTEM_BINS),
      npmRoot,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Install pi' })).toBeVisible();
    await expect(page.getByText('npm i -g @earendil-works/pi-coding-agent')).toBeVisible();
  } finally {
    await rm(npmRoot, { recursive: true, force: true });
  }
});

test('场景3：非 npm 安装的 pi → 一键切换引导', async ({ launchElectronApp }) => {
  // 假 prefix 且包不在真实 npm root 下 → 判为 non-npm（E2E 用可控布局保证可重复）。
  // Windows 上真实全局 root 里装着 pi，会遮蔽假 shim，须用空 root 钩子隔离。
  const fake = await makeFakeNpmPrefix('0.83.0');
  const emptyRoot = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-empty-root-'));
  try {
    const app = await launchElectronApp({
      userPath: joinPath(isWin ? fake.prefix : `${fake.prefix}/bin`, nodeBinDir, SYSTEM_BINS),
      ...(isWin ? { npmRoot: emptyRoot } : {}),
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Switch pi to the npm install' })).toBeVisible();
  } finally {
    await fake.cleanup();
    await rm(emptyRoot, { recursive: true, force: true });
  }
});

test('场景4：npm 安装但版本过低 → 阻断升级页', async ({ launchElectronApp }) => {
  const fake = await makeFakeNpmPrefix('0.82.0');
  try {
    const app = await launchElectronApp({
      userPath: joinPath(isWin ? fake.prefix : `${fake.prefix}/bin`, nodeBinDir, SYSTEM_BINS),
      npmRoot: fake.npmRoot,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'pi is too old' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/v0\.82\.0/)).toBeVisible();
  } finally {
    await fake.cleanup();
  }
});

test('场景5：npm 安装且版本达标 → 进入主界面', async ({ launchElectronApp }) => {
  const fake = await makeFakeNpmPrefix('0.83.0');
  try {
    const app = await launchElectronApp({
      userPath: joinPath(isWin ? fake.prefix : `${fake.prefix}/bin`, nodeBinDir, SYSTEM_BINS),
      npmRoot: fake.npmRoot,
    });
    const page = await app.firstWindow();
    await expect(page.getByTestId('nav-chat')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Choose folder' })).toBeVisible();
  } finally {
    await fake.cleanup();
  }
});

test('场景5b：npm 全局包已安装但 pi shim 不在 PATH → 仍进入主界面', async ({ launchElectronApp }) => {
  const fake = await makeFakeNpmPrefix('0.83.0');
  try {
    const app = await launchElectronApp({
      userPath: joinPath(nodeBinDir, SYSTEM_BINS),
      npmRoot: fake.npmRoot,
    });
    const page = await app.firstWindow();
    await expect(page.getByTestId('nav-chat')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose folder' })).toBeVisible();
  } finally {
    await fake.cleanup();
  }
});
