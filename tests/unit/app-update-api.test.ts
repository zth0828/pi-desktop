import { describe, expect, it } from 'vitest';
import { platformAssetArch, selectAsset, selectAssetName } from '@electron/services/app-update-api';

const assets = [
  { name: 'Pi.Desktop-1.1.0-x64.AppImage', browser_download_url: 'appimage-x64' },
  { name: 'Pi.Desktop-0.2.2-x86_64.AppImage', browser_download_url: 'appimage-x86_64' },
  { name: 'Pi.Desktop-0.2.2-amd64.deb', browser_download_url: 'deb' },
  { name: 'Pi.Desktop-Portable-0.2.2-x64.exe', browser_download_url: 'portable' },
  { name: 'Pi.Desktop-Setup-0.2.2-x64.exe', browser_download_url: 'setup' },
  { name: 'Pi.Desktop-0.2.2-arm64.dmg', browser_download_url: 'dmg-arm' },
  { name: 'Pi.Desktop-0.2.2-x64.dmg', browser_download_url: 'dmg-x64' },
];

describe('app update asset selection', () => {
  it('maps Linux x64 to x64, x86_64, amd64 aliases and prefers AppImage', () => {
    expect(platformAssetArch('linux', 'x64')).toEqual(['x64', 'x86_64', 'amd64']);
    expect(selectAsset(assets, 'linux', 'x64')).toEqual({ name: 'Pi.Desktop-1.1.0-x64.AppImage', url: 'appimage-x64' });
    expect(selectAssetName(assets, 'linux', 'x64')).toBe('Pi.Desktop-1.1.0-x64.AppImage');
  });

  it('maps Linux arm64 to arm64 and aarch64', () => {
    expect(platformAssetArch('linux', 'arm64')).toEqual(['arm64', 'aarch64']);
    const armLinuxAssets = [{ name: 'Pi.Desktop-1.1.0-aarch64.AppImage', browser_download_url: 'appimage-arm' }];
    expect(selectAsset(armLinuxAssets, 'linux', 'arm64')).toEqual({ name: 'Pi.Desktop-1.1.0-aarch64.AppImage', url: 'appimage-arm' });
  });

  it('uses the DEB fallback on Linux', () => {
    expect(selectAsset(assets.filter((asset) => asset.name.endsWith('.deb')), 'linux', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-amd64.deb', url: 'deb' });
  });

  it('prefers Windows Setup over Portable', () => {
    expect(selectAsset(assets, 'win32', 'x64')).toEqual({ name: 'Pi.Desktop-Setup-0.2.2-x64.exe', url: 'setup' });
    expect(selectAssetName(assets, 'win32', 'x64')).toBe('Pi.Desktop-Setup-0.2.2-x64.exe');
  });

  it('selects the matching macOS architecture', () => {
    expect(selectAsset(assets, 'darwin', 'arm64')).toEqual({ name: 'Pi.Desktop-0.2.2-arm64.dmg', url: 'dmg-arm' });
    expect(selectAsset(assets, 'darwin', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-x64.dmg', url: 'dmg-x64' });
    expect(selectAssetName(assets, 'darwin', 'arm64')).toBe('Pi.Desktop-0.2.2-arm64.dmg');
  });
});
