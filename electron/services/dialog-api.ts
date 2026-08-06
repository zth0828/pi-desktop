// dialog 模块：系统对话框（目录/文件选择）。
import { BrowserWindow, dialog } from 'electron';
import type { DialogOpenPayload, DialogOpenResult } from '@shared/host-api/contract';

export const dialogApi = {
  open: async (payload: DialogOpenPayload): Promise<DialogOpenResult> => {
    const win = BrowserWindow.getAllWindows()[0];
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
