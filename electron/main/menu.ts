// macOS 原生系统菜单栏：结构与 Windows/Linux renderer 自绘菜单栏对齐
// （文件/编辑/选择/查看/转到/运行/终端/帮助 八组 + 同样的菜单项与功能）。
// 所有 label 显式指定、不用 role 自动本地化，避免 macOS 按系统 UI 语言渲染
// role 项造成中英混杂；文案语言跟随应用设置（electron-store language，
// 与 renderer 的 i18n 同一来源），用户切换语言时 settings-api 触发重建。
// 平台差异只保留两处 macOS 必需项：应用菜单（关于/服务/隐藏/退出）与原生
// 编辑行为（copy/paste role 随选区自动启用/禁用）。
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { sendHostEventToWindow } from './ipc/host-events';
import { getElectronStore } from '../utils/electron-store';

export type NativeMenuAction = 'new-chat' | 'collapse-sidebar' | 'search-chats';

type MenuLabels = {
  file: string;
  newChat: string;
  closeWindow: string;
  edit: string;
  copy: string;
  paste: string;
  selection: string;
  view: string;
  collapseSidebar: string;
  searchChats: string;
  go: string;
  run: string;
  terminal: string;
  help: string;
  comingSoon: string;
};

/** 菜单文案：zh → 中文，其余英文（与 shared/i18n zh/en 两套文案保持一致）。 */
function menuLabels(language: string): MenuLabels {
  const zh = language.toLowerCase().startsWith('zh');
  return {
    file: zh ? '文件' : 'File',
    newChat: zh ? '新建会话' : 'New Chat',
    closeWindow: zh ? '关闭窗口' : 'Close Window',
    edit: zh ? '编辑' : 'Edit',
    copy: zh ? '复制' : 'Copy',
    paste: zh ? '粘贴' : 'Paste',
    selection: zh ? '选择' : 'Selection',
    view: zh ? '查看' : 'View',
    collapseSidebar: zh ? '折叠侧边栏' : 'Collapse Sidebar',
    searchChats: zh ? '会话搜索' : 'Search Chats',
    go: zh ? '转到' : 'Go',
    run: zh ? '运行' : 'Run',
    terminal: zh ? '终端' : 'Terminal',
    help: zh ? '帮助' : 'Help',
    comingSoon: zh ? '敬请期待' : 'Coming soon',
  };
}

/** 菜单语言：应用设置优先（用户可在设置页切换，Windows 自绘菜单即时跟随），
    未设置时回退系统 locale。 */
async function resolveMenuLanguage(): Promise<string> {
  try {
    const store = await getElectronStore();
    const language = store.get('language') as string | undefined;
    if (typeof language === 'string' && language) return language;
  } catch {
    // store 初始化失败时回退系统 locale，不影响菜单安装
  }
  return app.getLocale();
}

/** 业务菜单项 → 聚焦窗口的 renderer（App.tsx 绑定后走与自绘菜单相同的 action）。 */
function dispatchMenuAction(action: NativeMenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    sendHostEventToWindow(win, 'menu', 'action', { action });
  }
}

/** 关闭当前窗口：macOS 上窗口销毁、应用常驻 dock（activate 重建），
    与 Windows「关闭窗口 → 隐藏到托盘」语义一致。 */
function closeFocusedWindow(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.close();
}

function buildMenuTemplate(labels: MenuLabels): MenuItemConstructorOptions[] {
  return [
    // 不用 role:'appMenu'：macOS 系统菜单栏的应用菜单标题取自 bundle 的
    // CFBundleName（dev 下是 Electron.app → "Electron"），与 app.setName 解耦；
    // 显式 label 保证 dev/打包一致显示 Pi Desktop。
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: labels.file,
      submenu: [
        { label: labels.newChat, accelerator: 'CmdOrCtrl+N', click: () => dispatchMenuAction('new-chat') },
        { type: 'separator' },
        { label: labels.closeWindow, accelerator: 'CmdOrCtrl+W', click: closeFocusedWindow },
      ],
    },
    {
      label: labels.edit,
      submenu: [
        { role: 'copy', label: labels.copy },
        { role: 'paste', label: labels.paste },
      ],
    },
    {
      label: labels.selection,
      submenu: [{ label: labels.comingSoon, enabled: false }],
    },
    {
      label: labels.view,
      submenu: [
        {
          label: labels.collapseSidebar,
          accelerator: 'CmdOrCtrl+\\',
          click: () => dispatchMenuAction('collapse-sidebar'),
        },
        {
          label: labels.searchChats,
          accelerator: 'CmdOrCtrl+K',
          click: () => dispatchMenuAction('search-chats'),
        },
      ],
    },
    { label: labels.go, submenu: [{ label: labels.comingSoon, enabled: false }] },
    { label: labels.run, submenu: [{ label: labels.comingSoon, enabled: false }] },
    { label: labels.terminal, submenu: [{ label: labels.comingSoon, enabled: false }] },
    { label: labels.help, submenu: [{ label: labels.comingSoon, enabled: false }] },
  ];
}

/** 幂等重建应用菜单：启动与语言切换共用。 */
export async function rebuildNativeMacMenu(): Promise<void> {
  const language = await resolveMenuLanguage();
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(menuLabels(language))));
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log(`[menu] application menu installed (title=${app.getName()}, locale=${app.getLocale()}, ui=${language})`);
  }
}

export function installNativeMacMenu(): void {
  void rebuildNativeMacMenu().catch((error) => {
    // 菜单安装失败只影响菜单栏，不应触发 main 的 unhandledRejection 退出流程
    console.error('[menu] failed to install native menu', error);
  });
}
