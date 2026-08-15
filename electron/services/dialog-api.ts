// dialog 模块：系统对话框（目录/文件选择）。
import { BrowserWindow, dialog } from 'electron';
import type { DialogOpenPayload, DialogOpenResult } from '@shared/host-api/contract';
import type { HostActionContext } from '../main/ipc/host-contract';
import { getMainWindow } from '../main/window-manager';

export const dialogApi = {
  open: async (payload: DialogOpenPayload, ctx?: HostActionContext): Promise<DialogOpenResult> => {
    // 多窗口 M2：对话框挂在发起调用的窗口上；取不到（旧调用/窗口已销毁）回退主窗口
    const win = (ctx && BrowserWindow.fromWebContents(ctx.sender)) || getMainWindow();
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
};
