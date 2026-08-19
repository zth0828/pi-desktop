import { describe, expect, it } from 'vitest';
import { platformAssetArch, selectAsset } from '@electron/services/app-update-api';

const assets = [
  { name: 'Pi.Desktop-0.2.2-x86_64.AppImage', browser_download_url: 'appimage' },
  { name: 'Pi.Desktop-0.2.2-amd64.deb', browser_download_url: 'deb' },
  { name: 'Pi.Desktop-Portable-0.2.2-x64.exe', browser_download_url: 'portable' },
  { name: 'Pi.Desktop-Setup-0.2.2-x64.exe', browser_download_url: 'setup' },
  { name: 'Pi.Desktop-0.2.2-arm64.dmg', browser_download_url: 'dmg-arm' },
  { name: 'Pi.Desktop-0.2.2-x64.dmg', browser_download_url: 'dmg-x64' },
];

describe('app update asset selection', () => {
  it('maps Linux x64 to workflow x86_64 and prefers AppImage', () => {
    expect(platformAssetArch('linux', 'x64')).toEqual(['x86_64', 'amd64']);
    expect(selectAsset(assets, 'linux', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-x86_64.AppImage', url: 'appimage' });
  });

  it('uses the DEB fallback on Linux', () => {
    expect(selectAsset(assets.filter((asset) => asset.name.endsWith('.deb')), 'linux', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-amd64.deb', url: 'deb' });
  });

  it('prefers Windows Setup over Portable', () => {
    expect(selectAsset(assets, 'win32', 'x64')).toEqual({ name: 'Pi.Desktop-Setup-0.2.2-x64.exe', url: 'setup' });
  });

  it('selects the matching macOS architecture', () => {
    expect(selectAsset(assets, 'darwin', 'arm64')).toEqual({ name: 'Pi.Desktop-0.2.2-arm64.dmg', url: 'dmg-arm' });
    expect(selectAsset(assets, 'darwin', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-x64.dmg', url: 'dmg-x64' });
  });
});
