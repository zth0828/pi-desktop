// macOS 原生系统菜单栏：dev（electron 直接启动）与打包产物行为一致。
// 默认 Electron 菜单只有标准 roles、无业务项；这里补齐业务菜单
// （新建会话/折叠侧边栏/搜索会话）。Windows/Linux frameless 不设置原生菜单，
// 使用 renderer 自绘标题栏内的菜单栏。
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { sendHostEventToWindow } from './ipc/host-events';

export type NativeMenuAction = 'new-chat' | 'collapse-sidebar' | 'search-chats';

/** 业务菜单项 → 聚焦窗口的 renderer（App.tsx 绑定后走与自绘菜单相同的 action）。 */
function dispatchMenuAction(action: NativeMenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    sendHostEventToWindow(win, 'menu', 'action', { action });
  }
}

export function installNativeMacMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => dispatchMenuAction('new-chat') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Collapse Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => dispatchMenuAction('collapse-sidebar'),
        },
        {
          label: 'Search Chats',
          accelerator: 'CmdOrCtrl+K',
          click: () => dispatchMenuAction('search-chats'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
