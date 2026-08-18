import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { HostApiRegistry, registerHostInvokeHandler } from './ipc/host-invoke';
import { createMainWindow } from './window-manager';
import { createHostServices } from '../services';
import { disposeAllRuntimes, hasStreamingRuntimes } from '../services/pi-runtime-api';
import { DEV_RESTART_READY, DEV_RESTART_REQUEST } from '@shared/dev-reload';
import { resolveAppIconPath } from '../utils/app-icon';
import { safeErrorFields, writePiDiagnostic } from '../utils/pi-diagnostic-log';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

process.on('uncaughtException', (error) => {
  writePiDiagnostic({ level: 'error', event: 'main.uncaughtException', ...safeErrorFields(error) });
});
process.on('unhandledRejection', (reason) => {
  writePiDiagnostic({ level: 'error', event: 'main.unhandledRejection', ...safeErrorFields(reason) });
});

// 测试钩子：E2E 用隔离 userData（settings 等壳状态落在这里）
if (process.env.PI_DESKTOP_USER_DATA_DIR) {
  const isolatedUserData = process.env.PI_DESKTOP_USER_DATA_DIR;
  app.setPath('userData', isolatedUserData);
  // Keep system-directory features (session exports, downloads) inside the
  // fixture profile; Electron's documents path does not honor HOME overrides.
  app.setPath('documents', path.join(isolatedUserData, 'Documents'));
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

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.setIcon(resolveAppIconPath('png', {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      mainDir: __dirname,
    }));
  }
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (devRestartTimer) clearTimeout(devRestartTimer);
  disposeAllRuntimes();
});
