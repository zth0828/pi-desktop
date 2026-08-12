import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppIconPath } from '../../electron/utils/app-icon';

describe('resolveAppIconPath', () => {
  it('uses the project resources directory during development', () => {
    expect(resolveAppIconPath('png', {
      isPackaged: false,
      resourcesPath: '/Applications/Pi Desktop.app/Contents/Resources',
      mainDir: '/workspace/dist-electron/main',
    })).toBe(path.resolve('/workspace/resources/icon.png'));
  });

  it('uses Electron resources in packaged builds', () => {
    expect(resolveAppIconPath('ico', {
      isPackaged: true,
      resourcesPath: '/Applications/Pi Desktop.app/Contents/Resources',
      mainDir: '/workspace/dist-electron/main',
    })).toBe('/Applications/Pi Desktop.app/Contents/Resources/icon.ico');
  });
});
