import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { resolveAppPageId } from '@shared/app-page';
import { HostApiRegistry, registerHostInvokeHandler } from './ipc/host-invoke';
import { createHostServices } from '../services';

// M1 skeleton: minimal single window. Tray/menu/single-instance/session
// recovery are ported from ClawX in later batches (see docs/TECHNICAL-PLAN.md §5.1).

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 测试钩子：E2E 用隔离 userData（settings 等壳状态落在这里）
if (process.env.PI_DESKTOP_USER_DATA_DIR) {
  app.setPath('userData', process.env.PI_DESKTOP_USER_DATA_DIR);
}

// Package catalog/detail cache lives with the isolated Electron profile.
process.env.PI_PACKAGE_CATALOG_CACHE_DIR = path.join(app.getPath('userData'), 'package-cache');

const hostRegistry = new HostApiRegistry();
hostRegistry.registerCoreServices(createHostServices());
registerHostInvokeHandler(hostRegistry);

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    // 侧栏 + 聊天列(420) + 右侧面板的最小可用宽度；窄于此面板自动转覆盖层（CSS 媒体查询）
    minWidth: 960,
    minHeight: 640,
    title: 'Pi Desktop',
    // 让 macOS 原生红黄绿按钮叠在应用内容上，避免额外占一整行标题栏。
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const canUseInitialPage = Boolean(process.env.VITE_DEV_SERVER_URL)
    || process.env.PI_DESKTOP_E2E === '1';
  const initialPage = canUseInitialPage
    ? resolveAppPageId(process.env.PI_DESKTOP_DEV_INITIAL_PAGE)
    : undefined;

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    if (initialPage) url.searchParams.set('page', initialPage);
    win.loadURL(url.toString());
  } else {
    win.loadFile(
      path.join(__dirname, '../../dist/index.html'),
      initialPage ? { query: { page: initialPage } } : undefined,
    );
  }
  return win;
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
