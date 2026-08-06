// 极简 Electron E2E fixture。
// Inspired by ClawX: tests/e2e/fixtures/electron.ts（只保留启动/关窗/隔离 HOME，
// 去掉 gateway/attachment 等 ClawX 专属 mock 体系）。
// 场景控制走两个测试钩子环境变量：
//   PI_DESKTOP_USER_PATH  — 覆盖 PATH 解析（模拟无 Node/无 pi/非 npm 安装等）
//   PI_DESKTOP_NPM_ROOT   — 覆盖 npm root -g 结果（模拟临时 npm prefix）
import electronBinaryPathImport from 'electron';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// electron 包的默认导出运行时是二进制路径字符串，但类型声明是模块对象
const electronBinaryPath = electronBinaryPathImport as unknown as string;

export type LaunchOptions = {
  /** 直接作为 PATH 使用的值（不经过 login shell 合并） */
  userPath?: string;
  npmRoot?: string;
};

type ElectronFixtures = {
  homeDir: string;
  launchElectronApp: (options?: LaunchOptions) => Promise<ElectronApplication>;
  electronApp: ElectronApplication;
  page: Page;
};

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  const closed = await Promise.race([
    app
      .waitForEvent('close', { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false),
    app.evaluate(({ app: electronApp }) => electronApp.quit()).then(() => true).catch(() => false),
    new Promise<false>((resolveFalse) => setTimeout(() => resolveFalse(false), timeoutMs)),
  ]);
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
      return await electron.launch({
        executablePath: electronBinaryPath,
        args: ['--lang=en-US', electronEntry],
        env: {
          ...process.env,
          HOME: homeDir,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          ...(options.userPath ? { PI_DESKTOP_USER_PATH: options.userPath } : {}),
          ...(options.npmRoot ? { PI_DESKTOP_NPM_ROOT: options.npmRoot } : {}),
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
