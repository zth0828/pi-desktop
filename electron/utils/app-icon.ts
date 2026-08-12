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
