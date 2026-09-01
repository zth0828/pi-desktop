import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { HostApiRegistry, registerHostInvokeHandler } from './ipc/host-invoke';
import { createMainWindow, focusOrCreateMainWindow, setQuitting } from './window-manager';
import { createTray } from './tray';
import { createHostServices } from '../services';
import { disposeAllRuntimes, hasStreamingRuntimes } from '../services/pi-runtime-api';
import { DEV_RESTART_READY, DEV_RESTART_REQUEST } from '@shared/dev-reload';
import { resolveAppIconPath } from '../utils/app-icon';
import { safeErrorFields, writePiDiagnostic } from '../utils/pi-diagnostic-log';
import { scheduleVersionChecks } from '../services/version-check-api';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// dev 下 app.name 默认是 Electron，打包产物是 productName（Pi Desktop）；
// 统一全平台应用名，确保 macOS 系统菜单栏与 Linux X11/Wayland 的 WM_CLASS 一致。
// 需在 userData 派生之前设置（dev 下 userData 也随之与打包产物对齐）。
app.setName('Pi Desktop');

// Windows 通知/任务栏/托盘归属：与 electron-builder 的 appId 一致，
// dev 模式（electron.exe）下也按应用身份分组，通知不再挂到 Electron 名下。
if (process.platform === 'win32') {
  app.setAppUserModelId('io.github.zth0828.pidesktop');
}

let fatalMainFailure = false;
function handleFatalMainFailure(event: string, error: unknown): void {
  if (fatalMainFailure) return;
  fatalMainFailure = true;
  writePiDiagnostic({ level: 'error', event, ...safeErrorFields(error) });
  // Continuing after an uncaught main-process failure can leave IPC/runtime state
  // inconsistent. Electron performs the normal before-quit cleanup path.
  app.quit();
}
process.on('uncaughtException', (error) => handleFatalMainFailure('main.uncaughtException', error));
process.on('unhandledRejection', (reason) => handleFatalMainFailure('main.unhandledRejection', reason));

// 测试钩子：E2E 用隔离 userData（settings 等壳状态落在这里）
if (process.env.PI_DESKTOP_USER_DATA_DIR) {
  const isolatedUserData = process.env.PI_DESKTOP_USER_DATA_DIR;
  app.setPath('userData', isolatedUserData);
  // Keep system-directory features (session exports, downloads) inside the
  // fixture profile; Electron's documents path does not honor HOME overrides.
  app.setPath('documents', path.join(isolatedUserData, 'Documents'));
  app.setPath('downloads', path.join(isolatedUserData, 'Downloads'));
}

// Package catalog/detail cache lives with the isolated Electron profile.
process.env.PI_PACKAGE_CATALOG_CACHE_DIR = path.join(app.getPath('userData'), 'package-cache');

const hostRegistry = new HostApiRegistry();
hostRegistry.registerCoreServices(createHostServices());
registerHostInvokeHandler(hostRegistry);

let devRestartPending = false;
let devRestartTimer: NodeJS.Timeout | null = null;

function checkDevRestart(): void {
  devRestartTimer = null;
  if (!devRestartPending) return;
  if (hasStreamingRuntimes()) {
    devRestartTimer = setTimeout(checkDevRestart, 250);
    return;
  }
  devRestartPending = false;
  process.send?.(DEV_RESTART_READY);
}

if (process.env.VITE_DEV_SERVER_URL) {
  process.on('message', (message: unknown) => {
    if (message !== DEV_RESTART_REQUEST) return;
    devRestartPending = true;
    if (devRestartTimer == null) checkDevRestart();
  });
}

// 单实例锁：Windows/Linux 主窗口关闭会 hide 到托盘继续运行；再次启动快捷方式
// 必须聚焦已有实例，而不是开第二个进程——第二个实例与托盘实例共用 userData，
// 磁盘缓存互相冲突（GPU/disk cache access denied，见 dev-server.log），
// 渲染进程可能白屏且状态混乱（“打开软件空白”）。
// dev 模式（vite 重启 electron 同一 userData 是常态）与 E2E（每个用例隔离
// userData，锁按 userData 路径互斥）跳过。
const hasSingleInstanceLock = process.env.VITE_DEV_SERVER_URL || process.env.PI_DESKTOP_E2E === '1'
  ? true
  : app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 事件在持锁实例（首个）触发：聚焦/恢复已 hide 到托盘的主窗口。
    focusOrCreateMainWindow();
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock?.setIcon(resolveAppIconPath('png', {
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        mainDir: __dirname,
      }));
    }
    createMainWindow();
    createTray();
    scheduleVersionChecks();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // 先放行主窗口 close 拦截（否则 quit 流程被 preventDefault 卡住），再清理 runtime。
    setQuitting(true);
    if (devRestartTimer) clearTimeout(devRestartTimer);
    disposeAllRuntimes();
  });
}
