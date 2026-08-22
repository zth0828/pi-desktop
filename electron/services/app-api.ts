// app 模块：壳自身信息与基础编辑命令。
import { app, BrowserWindow, clipboard, nativeImage } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AppClipboardImagePayload,
  AppEditCommandPayload,
  AppWriteBinaryFilePayload,
  HostSuccess,
} from '@shared/host-api/contract';

function resolveAppVersion(): string {
  const version = app.getVersion();
  // 开发模式（electron <entry> 启动）下 app path 指向 dist-electron/main，
  // getVersion() 会回退成 Electron 自身版本——此时读壳的 package.json
  if (version && version !== process.versions.electron) return version;
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(app.getAppPath(), '../../package.json'), 'utf8'),
    ) as { version?: string };
    return manifest.version ?? version;
  } catch {
    return version;
  }
}

export const appApi = {
  version: () => resolveAppVersion(),
  name: () => app.getName(),
  platform: () => process.platform,
  writeClipboard: (payload: { text: string }) => {
    clipboard.writeText(payload.text);
    return { success: true };
  },
  writeClipboardImage: (payload: AppClipboardImagePayload): HostSuccess => {
    try {
      const buffer = Buffer.from(payload.data, 'base64');
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to create image from buffer' };
      }
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  writeBinaryFile: async (payload: AppWriteBinaryFilePayload): Promise<HostSuccess> => {
    try {
      const buffer = Buffer.from(payload.data, 'base64');
      await fs.writeFile(payload.path, buffer);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  editCommand: (payload: AppEditCommandPayload): HostSuccess => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'No active window' };
    }
    const contents = win.webContents;
    contents.focus();
    switch (payload.command) {
      case 'undo':
        contents.undo();
        break;
      case 'redo':
        contents.redo();
        break;
      case 'cut':
        contents.cut();
        break;
      case 'copy':
        contents.copy();
        break;
      case 'paste':
        contents.paste();
        break;
      case 'selectAll':
        contents.selectAll();
        break;
      default:
        return { success: false, error: `Unknown edit command: ${String(payload.command)}` };
    }
    return { success: true };
  },
};
