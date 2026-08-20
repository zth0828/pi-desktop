import path from 'node:path';

export type AppIconFormat = 'png' | 'ico' | 'icns';

export function resolveAppIconPath(
  format: AppIconFormat,
  options: { isPackaged: boolean; resourcesPath: string; mainDir: string },
): string {
  const fileName = `icon.${format}`;
  return options.isPackaged
    ? path.join(options.resourcesPath, fileName)
    : path.resolve(options.mainDir, '../../resources', fileName);
}

/** 窗口/托盘图标格式：Windows 用 ico（多尺寸，任务栏缩略图与托盘都稳），其余平台 png。 */
export function windowIconFormat(platform: NodeJS.Platform = process.platform): AppIconFormat {
  return platform === 'win32' ? 'ico' : 'png';
}
