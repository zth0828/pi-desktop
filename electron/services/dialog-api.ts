// dialog 模块：系统对话框（目录/文件选择与保存）。
import { BrowserWindow, dialog } from 'electron';
import type {
  DialogOpenPayload,
  DialogOpenResult,
  DialogSavePayload,
  DialogSaveResult,
} from '@shared/host-api/contract';
import type { HostActionContext } from '../main/ipc/host-contract';
import { getMainWindow } from '../main/window-manager';

export const dialogApi = {
  open: async (payload: DialogOpenPayload, ctx?: HostActionContext): Promise<DialogOpenResult> => {
    // 对话框挂在发起调用的窗口上；取不到（旧调用/窗口已销毁）回退主窗口。
    // 主窗口隐藏到托盘后仍是 getMainWindow() 的返回值，挂到隐藏窗口上对话框
    // 不会显示，先 show 再挂。
    const win = (ctx && BrowserWindow.fromWebContents(ctx.sender)) || getMainWindow();
    if (win && !win.isVisible()) win.show();
    const options = {
      title: payload.title,
      defaultPath: payload.defaultPath,
      properties: payload.properties ?? ['openDirectory' as const],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, filePaths: result.filePaths };
  },
  save: async (payload: DialogSavePayload, ctx?: HostActionContext): Promise<DialogSaveResult> => {
    const win = (ctx && BrowserWindow.fromWebContents(ctx.sender)) || getMainWindow();
    if (win && !win.isVisible()) win.show();
    const options = {
      title: payload.title,
      defaultPath: payload.defaultPath,
      filters: payload.filters,
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return { canceled: result.canceled, filePath: result.filePath };
  },
};
