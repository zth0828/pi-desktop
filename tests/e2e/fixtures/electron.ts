// 极简 Electron E2E fixture（启动/关窗/隔离 HOME）。
// 环境隔离钩子：
//   PI_DESKTOP_USER_PATH  — 覆盖 PATH 解析（onboarding 场景模拟）
//   PI_DESKTOP_NPM_ROOT   — 覆盖 npm root -g 结果
//   PI_CODING_AGENT_DIR   — pi 自己的配置目录隔离（models.json/sessions 等）
import electronBinaryPathImport from 'electron';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
  /** GitHub release API 测试替身地址 */
  githubApiUrl?: string;
  /** npm package 安装测试使用的 registry 地址。 */
  npmRegistryUrl?: string;
  /** 仅 E2E：缩短主进程会话启动超时（毫秒），驱动 start-timeout 场景。 */
  startTimeoutMs?: number;
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

// Windows 上只杀主进程会留下 renderer/GPU/utility 孤儿进程，继续占用
// user-data 里的文件（DIPS 等），导致后续 rm EBUSY；必须杀整棵进程树。
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    } catch {
      // 落入通用分支
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore
  }
}

function shallowStripEnv(env: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of keys) delete next[key];
  return next;
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let pid: number | undefined;
  try {
    const child = app.process();
    if (child.exitCode !== null || child.signalCode !== null) return;
    pid = child.pid;
  } catch {
    return;
  }
  const closeEvent = app
    .waitForEvent('close', { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  // evaluate 本身也可能挂住（CDP 目标无响应），必须限时
  await Promise.race([
    app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined),
    new Promise<void>((resolveWait) => setTimeout(resolveWait, timeoutMs)),
  ]);
  let closed = await closeEvent;
  if (!closed) {
    closed = await Promise.race([
      app.close().then(() => true).catch(() => false),
      new Promise<false>((resolveFalse) => setTimeout(() => resolveFalse(false), timeoutMs)),
    ]);
  }
  if (!closed && pid !== undefined) {
    killProcessTree(pid);
  }
  // 等进程真正退出；Windows 上文件句柄释放晚于进程终止，稍候避免 rm EBUSY
  if (pid !== undefined) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({}, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-e2e-home-'));
    try {
      await provideHomeDir(homeDir);
    } finally {
      // Windows 上文件锁释放有延迟，重试几次避免 EBUSY 污染测试结果
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        }
      }
      if (lastError) throw lastError;
    }
  },

  launchElectronApp: async ({ homeDir }, provideLauncher) => {
    const launchedApps: ElectronApplication[] = [];
    try {
      await provideLauncher(async (options: LaunchOptions = {}) => {
        if (options.seedSettings) {
          // electron-store 默认文件：<userData>/config.json（userData 经测试钩子固定）
          const userDataDir = join(homeDir, 'user-data');
          await mkdir(userDataDir, { recursive: true });
          await writeFile(join(userDataDir, 'config.json'), JSON.stringify(options.seedSettings));
        }
        const piEnv = options.withPi ? piTestEnv() : null;
        // Windows 的 PATH 用 `;` 分隔且没有 /usr/bin:/bin；POSIX 形态的默认值在
        // Windows 上会被当成单个目录，导致 node/npm/pi 全部检测失败。
        // 懒求值：仅 withPi 场景才有 piEnv
        const defaultUserPath = () => (process.platform === 'win32'
          ? [piEnv!.piBinDir, nodeBinDir].join(path.delimiter)
          : `${piEnv!.piBinDir}:${nodeBinDir}:/usr/bin:/bin`);
        const app = await electron.launch({
          executablePath: electronBinaryPath,
          // darwin 直跑 node_modules 裸 Electron 时 seatbelt 沙箱初始化会 EPERM，
          // GPU 进程反复崩溃（白屏）；与 packaged-macos.spec.ts 一律加 --no-sandbox。
          args: [
            '--lang=en-US',
            ...(process.platform === 'darwin' ? ['--no-sandbox'] : []),
            electronEntry,
          ],
          env: {
            // IDE 内嵌终端注入的 ELECTRON_FORCE_IS_PACKAGED 会让裸 Electron 的
            // app.isPackaged 变 true，main 走打包分支（resourcesPath 图标等解析失败）
            // 后 uncaughtException → app.quit()，全部用例启动即退；E2E 固定跑
            // dist-electron 裸入口，必须剥离该注入（解构丢弃，避免 env 里出现
            // undefined 值违反 Record<string, string> 类型）。
            ...shallowStripEnv(process.env, ['ELECTRON_FORCE_IS_PACKAGED']),
            HOME: homeDir,
            // Windows 的 os.homedir()/Electron 读 USERPROFILE 而非 HOME，不隔离会穿透到真实用户目录
            ...(process.platform === 'win32' ? { USERPROFILE: homeDir } : {}),
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8',
            // E2E 只连本地 mock server：任何继承/系统代理都会干扰 loopback，显式豁免。
            NO_PROXY: '127.0.0.1,localhost,::1',
            no_proxy: '127.0.0.1,localhost,::1',
            ...(options.userPath !== undefined || piEnv
              ? {
                PI_DESKTOP_USER_PATH: options.userPath ?? defaultUserPath(),
              }
              : {}),
            ...(options.npmRoot ?? piEnv
              ? { PI_DESKTOP_NPM_ROOT: options.npmRoot ?? piEnv!.npmRoot }
              : {}),
            ...(options.agentDir ? { PI_CODING_AGENT_DIR: options.agentDir } : {}),
            // 默认指向本地拒绝连接的地址：不打真实 GitHub API，否则更新提示
            // toast 会弹出并盖住 composer（版本更新场景由 version-update.spec 显式传 mock）。
            ...(options.githubApiUrl
              ? { PI_DESKTOP_GITHUB_API_URL: options.githubApiUrl }
              : { PI_DESKTOP_GITHUB_API_URL: 'http://127.0.0.1:9/releases/latest' }),
            // 同理：pi 版本检查默认也不打真实 npm registry，避免 pi 升级提示 toast 弹出。
            PI_DESKTOP_PI_REGISTRY_URL: 'http://127.0.0.1:9/pi',
            ...(options.packageCatalogUrl ? { PI_PACKAGE_CATALOG_URL: options.packageCatalogUrl } : {}),
            ...(options.npmRegistryUrl ? { npm_config_registry: options.npmRegistryUrl } : {}),
            ...(options.startTimeoutMs !== undefined
              ? { PI_DESKTOP_E2E: '1', PI_DESKTOP_START_TIMEOUT_MS: String(options.startTimeoutMs) }
              : {}),
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
        launchedApps.push(app);
        return app;
      });
    } finally {
      for (const app of launchedApps.reverse()) await closeElectronApp(app);
    }
  },

  electronApp: async ({ launchElectronApp }, provideElectronApp) => {
    const app = await launchElectronApp();
    await provideElectronApp(app);
  },

  page: async ({ electronApp }, providePage) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await providePage(page);
  },
});

export { expect } from '@playwright/test';
export { closeElectronApp };
