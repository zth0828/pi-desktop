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
import { stripWindowsExtendedPrefix } from '../utils/same-path';

function resolveDialogWindow(ctx?: HostActionContext): BrowserWindow | null {
  try {
    if (ctx?.sender && !ctx.sender.isDestroyed()) {
      const win = BrowserWindow.fromWebContents(ctx.sender);
      if (win && !win.isDestroyed()) return win;
    }
  } catch {
    // ignore
  }
  const main = getMainWindow();
  return main && !main.isDestroyed() ? main : null;
}

export const dialogApi = {
  open: async (payload: DialogOpenPayload, ctx?: HostActionContext): Promise<DialogOpenResult> => {
    const win = resolveDialogWindow(ctx);
    if (win && !win.isVisible()) win.show();
    const options = {
      title: payload?.title,
      defaultPath: payload?.defaultPath ? stripWindowsExtendedPrefix(payload.defaultPath) : undefined,
      properties: payload?.properties ?? ['openDirectory' as const],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, filePaths: result.filePaths };
  },
  save: async (payload: DialogSavePayload, ctx?: HostActionContext): Promise<DialogSaveResult> => {
    const win = resolveDialogWindow(ctx);
    if (win && !win.isVisible()) win.show();
    const options = {
      title: payload?.title,
      defaultPath: payload?.defaultPath ? stripWindowsExtendedPrefix(payload.defaultPath) : undefined,
      filters: payload?.filters,
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return { canceled: result.canceled, filePath: result.filePath };
  },
};
