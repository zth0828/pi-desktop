// 系统托盘（Windows/Linux）：主窗口关闭后隐藏到托盘继续运行，托盘是唯一的
// 恢复与退出入口。macOS 不创建（dock 已承担，activate 事件负责重建主窗口）。
// 图标解析失败时降级：不创建托盘，不影响主流程（hide 行为不依赖托盘）。
import { app, Menu, nativeImage, Notification, Tray } from 'electron';
import { resolveAppIconPath, windowIconFormat } from '../utils/app-icon';
import { focusOrCreateMainWindow } from './window-manager';
import { resolveMenuLanguage } from './menu';

let tray: Tray | null = null;
let hasNotifiedTrayMinimized = false;

export function showTrayMinimizedNotice(zh: boolean): void {
  if (process.platform === 'darwin') return;
  if (hasNotifiedTrayMinimized) return;
  hasNotifiedTrayMinimized = true;

  const title = 'Pi Desktop';
  const content = zh
    ? '应用已最小化到系统托盘，将在后台继续运行。'
    : 'Pi Desktop is minimized to the system tray and running in the background.';

  if (tray && process.platform === 'win32') {
    try {
      tray.displayBalloon({ title, content });
      return;
    } catch {
      // 托盘气泡不可用时回退标准通知
    }
  }

  if (Notification.isSupported()) {
    try {
      const notice = new Notification({ title, body: content });
      notice.on('click', () => focusOrCreateMainWindow());
      notice.show();
    } catch {
      // 忽略通知不可用
    }
  }
}

export async function rebuildTrayMenu(): Promise<void> {
  if (!tray) return;
  const language = await resolveMenuLanguage();
  const zh = language.toLowerCase().startsWith('zh');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: zh ? '显示主窗口' : 'Show Main Window', click: () => focusOrCreateMainWindow() },
      { type: 'separator' },
      { label: zh ? '退出' : 'Quit', click: () => app.quit() },
    ]),
  );
}

export function createTray(): void {
  if (process.platform === 'darwin') return;
  if (tray) return;
  try {
    // 平台化格式：Windows 托盘用 ico（多尺寸），Linux 用 png（nativeImage 对
    // ico 支持不保证，png 通用）。
    const iconPath = resolveAppIconPath(windowIconFormat(), {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      mainDir: __dirname,
    });
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    if (process.platform === 'linux') {
      image = image.resize({ width: 24, height: 24 });
    }
    tray = new Tray(image);

    tray.setToolTip('Pi Desktop');
    tray.on('click', () => focusOrCreateMainWindow());
    void rebuildTrayMenu();
  } catch {
    tray = null;
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
