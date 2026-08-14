// 极简 Electron E2E fixture。
// Inspired by ClawX: tests/e2e/fixtures/electron.ts（只保留启动/关窗/隔离 HOME，
// 去掉 gateway/attachment 等 ClawX 专属 mock 体系）。
// 环境隔离钩子：
//   PI_DESKTOP_USER_PATH  — 覆盖 PATH 解析（onboarding 场景模拟）
//   PI_DESKTOP_NPM_ROOT   — 覆盖 npm root -g 结果
//   PI_CODING_AGENT_DIR   — pi 自己的配置目录隔离（models.json/sessions 等）
import electronBinaryPathImport from 'electron';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';
import { piTestEnv } from '../../helpers/pi-prefix';

// electron 包的默认导出运行时是二进制路径字符串，但类型声明是模块对象
const electronBinaryPath = electronBinaryPathImport as unknown as string;

export type LaunchOptions = {
  /** 直接作为 PATH 使用的值（不经过 login shell 合并） */
  userPath?: string;
  npmRoot?: string;
  /** 使用测试前缀里 npm 安装的 pi（onboarding 走 ready 路径） */
  withPi?: boolean;
  /** pi 的配置目录（models.json/sessions 隔离） */
  agentDir?: string;
  /** 预置壳设置（如 workspaceCwd；布尔项如 preventSleep 直接给 boolean） */
  seedSettings?: Record<string, unknown>;
  /** 官方 Package Catalog 的测试替身地址。 */
  packageCatalogUrl?: string;
  /** npm package 安装测试使用的 registry 地址。 */
  npmRegistryUrl?: string;
  /** 仅 E2E：模拟 dev 脚本指定的初始功能页。 */
  initialPage?: string;
  /** 仅 E2E：模拟 dev 脚本显式选择非 npm pi 包。 */
  devPiPackageRoot?: string;
  devAllowOutdated?: boolean;
};

type ElectronFixtures = {
  homeDir: string;
  launchElectronApp: (options?: LaunchOptions) => Promise<ElectronApplication>;
  electronApp: ElectronApplication;
  page: Page;
};

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
const nodeBinDir = path.dirname(process.execPath);

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  const closeEvent = app
    .waitForEvent('close', { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  const closed = await closeEvent;
  if (closed) return;
  try {
    await app.close();
  } catch {
    try {
      app.process().kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({}, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-e2e-home-'));
    try {
      await provideHomeDir(homeDir);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  },

  launchElectronApp: async ({ homeDir }, provideLauncher) => {
    await provideLauncher(async (options: LaunchOptions = {}) => {
      if (options.seedSettings) {
        // electron-store 默认文件：<userData>/config.json（userData 经测试钩子固定）
        const userDataDir = join(homeDir, 'user-data');
        await mkdir(userDataDir, { recursive: true });
        await writeFile(join(userDataDir, 'config.json'), JSON.stringify(options.seedSettings));
      }
      const piEnv = options.withPi ? piTestEnv() : null;
      return await electron.launch({
        executablePath: electronBinaryPath,
        args: ['--lang=en-US', electronEntry],
        env: {
          ...process.env,
          HOME: homeDir,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          ...(options.userPath !== undefined || piEnv
            ? {
              PI_DESKTOP_USER_PATH: options.userPath
                ?? `${piEnv!.piBinDir}:${nodeBinDir}:/usr/bin:/bin`,
            }
            : {}),
          ...(options.npmRoot ?? piEnv
            ? { PI_DESKTOP_NPM_ROOT: options.npmRoot ?? piEnv!.npmRoot }
            : {}),
          ...(options.agentDir ? { PI_CODING_AGENT_DIR: options.agentDir } : {}),
          ...(options.packageCatalogUrl ? { PI_PACKAGE_CATALOG_URL: options.packageCatalogUrl } : {}),
          ...(options.npmRegistryUrl ? { npm_config_registry: options.npmRegistryUrl } : {}),
          ...(options.initialPage
            ? { PI_DESKTOP_E2E: '1', PI_DESKTOP_DEV_INITIAL_PAGE: options.initialPage }
            : {}),
          ...(options.devPiPackageRoot
            ? {
              PI_DESKTOP_E2E: '1',
              PI_DESKTOP_DEV_ALLOW_NON_NPM: '1',
              PI_DESKTOP_DEV_PI_PACKAGE_ROOT: options.devPiPackageRoot,
            }
            : {}),
          ...(options.devAllowOutdated ? { PI_DESKTOP_DEV_ALLOW_OUTDATED: '1' } : {}),
          PI_DESKTOP_USER_DATA_DIR: join(homeDir, 'user-data'),
        },
        timeout: 60_000,
      });
    });
  },

  electronApp: async ({ launchElectronApp }, provideElectronApp) => {
    const app = await launchElectronApp();
    try {
      await provideElectronApp(app);
    } finally {
      await closeElectronApp(app);
    }
  },

  page: async ({ electronApp }, providePage) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await providePage(page);
  },
});

export { expect } from '@playwright/test';
export { closeElectronApp };
