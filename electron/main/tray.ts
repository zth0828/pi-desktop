// 系统托盘（Windows/Linux）：主窗口关闭后隐藏到托盘继续运行，托盘是唯一的
// 恢复与退出入口。macOS 不创建（dock 已承担，activate 事件负责重建主窗口）。
// 图标解析失败时降级：不创建托盘，不影响主流程（hide 行为不依赖托盘）。
import { app, Menu, nativeImage, Tray } from 'electron';
import { resolveAppIconPath, windowIconFormat } from '../utils/app-icon';
import { focusOrCreateMainWindow } from './window-manager';

let tray: Tray | null = null;

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
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    tray = new Tray(image);
    tray.setToolTip('Pi Desktop');
    tray.on('click', () => focusOrCreateMainWindow());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => focusOrCreateMainWindow() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
  } catch {
    tray = null;
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
