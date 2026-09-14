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
  it('returns null for unsupported platforms', () => {
    expect(selectAsset(assets, 'linux', 'x64')).toBeNull();
  });

  it('prefers Windows Setup over Portable', () => {
    expect(selectAsset(assets, 'win32', 'x64')).toEqual({ name: 'Pi.Desktop-Setup-0.2.2-x64.exe', url: 'setup' });
    expect(selectAssetName(assets, 'win32', 'x64')).toBe('Pi.Desktop-Setup-0.2.2-x64.exe');
  });

  it('selects the matching macOS architecture and falls back to dmg when zip is absent', () => {
    expect(selectAsset(assets, 'darwin', 'arm64')).toEqual({ name: 'Pi.Desktop-0.2.2-arm64.dmg', url: 'dmg-arm' });
    expect(selectAsset(assets, 'darwin', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-x64.dmg', url: 'dmg-x64' });
    expect(selectAssetName(assets, 'darwin', 'arm64')).toBe('Pi.Desktop-0.2.2-arm64.dmg');
  });

  it('prefers zip on macOS for in-place auto-update when available', () => {
    const assetsWithZip = [
      ...assets,
      { name: 'Pi.Desktop-0.2.2-arm64.zip', browser_download_url: 'zip-arm' },
      { name: 'Pi.Desktop-0.2.2-mac-x64.zip', browser_download_url: 'zip-x64' },
    ];
    expect(selectAsset(assetsWithZip, 'darwin', 'arm64')).toEqual({ name: 'Pi.Desktop-0.2.2-arm64.zip', url: 'zip-arm' });
    expect(selectAsset(assetsWithZip, 'darwin', 'x64')).toEqual({ name: 'Pi.Desktop-0.2.2-mac-x64.zip', url: 'zip-x64' });
    expect(selectAssetName(assetsWithZip, 'darwin', 'arm64')).toBe('Pi.Desktop-0.2.2-arm64.zip');
  });
});
