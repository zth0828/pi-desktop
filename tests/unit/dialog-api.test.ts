import { beforeEach, describe, expect, it, vi } from 'vitest';

const showOpenDialogMock = vi.fn();
const showSaveDialogMock = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => null,
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialogMock(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialogMock(...args),
  },
}));

vi.mock('@electron/main/window-manager', () => ({
  getMainWindow: () => null,
}));

import { dialogApi } from '@electron/services/dialog-api';

describe('dialogApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles open dialog', async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: ['/test/dir'] });
    const res = await dialogApi.open({ title: 'Select' });
    expect(res).toEqual({ canceled: false, filePaths: ['/test/dir'] });
    expect(showOpenDialogMock).toHaveBeenCalled();
  });

  it('handles save dialog', async () => {
    showSaveDialogMock.mockResolvedValueOnce({ canceled: false, filePath: '/test/image.png' });
    const res = await dialogApi.save({
      title: 'Save Image',
      defaultPath: 'image.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    expect(res).toEqual({ canceled: false, filePath: '/test/image.png' });
    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Image',
        defaultPath: 'image.png',
        filters: [{ name: 'PNG', extensions: ['png'] }],
      }),
    );
  });

  it('handles canceled save dialog', async () => {
    showSaveDialogMock.mockResolvedValueOnce({ canceled: true });
    const res = await dialogApi.save({});
    expect(res).toEqual({ canceled: true, filePath: undefined });
  });

  it('剥离 defaultPath 中的 Windows 扩展前缀 (\\\\?\\)', async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\projects\\app'] });
    await dialogApi.open({ defaultPath: '\\\\?\\C:\\projects\\app' });
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'C:\\projects\\app' }),
    );

    showSaveDialogMock.mockResolvedValueOnce({ canceled: false, filePath: 'C:\\projects\\app\\file.txt' });
    await dialogApi.save({ defaultPath: '\\\\?\\C:\\projects\\app\\file.txt' });
    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'C:\\projects\\app\\file.txt' }),
    );
  });

  it('过滤 defaultPath 中的 Windows 设备路径与非法类型', async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: true });
    await dialogApi.open({ defaultPath: 'CON' });
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: undefined }),
    );

    showOpenDialogMock.mockResolvedValueOnce({ canceled: true });
    await dialogApi.open({ defaultPath: '\\\\.\\pipe\\test' });
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: undefined }),
    );

    showSaveDialogMock.mockResolvedValueOnce({ canceled: true });
    await dialogApi.save({ defaultPath: 123 as unknown as string });
    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: undefined }),
    );
  });
});
