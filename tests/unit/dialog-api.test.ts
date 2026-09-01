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
});
