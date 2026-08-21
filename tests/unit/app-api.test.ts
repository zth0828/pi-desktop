import { beforeEach, describe, expect, it, vi } from 'vitest';

const webContentsMock = {
  focus: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  cut: vi.fn(),
  copy: vi.fn(),
  paste: vi.fn(),
  selectAll: vi.fn(),
};

const focusedWindowMock = {
  isDestroyed: () => false,
  webContents: webContentsMock,
};

let focusedWindow: typeof focusedWindowMock | null = focusedWindowMock;
let clipboardText = '';

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.4.0',
    getName: () => 'Pi Desktop',
    getAppPath: () => '/mock/app/path',
  },
  clipboard: {
    writeText: (text: string) => {
      clipboardText = text;
    },
  },
  BrowserWindow: {
    getFocusedWindow: () => focusedWindow,
    getAllWindows: () => (focusedWindow ? [focusedWindow] : []),
  },
}));

import { appApi } from '@electron/services/app-api';

describe('appApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusedWindow = focusedWindowMock;
    clipboardText = '';
  });

  it('reports app version, name, and platform', () => {
    expect(appApi.name()).toBe('Pi Desktop');
    expect(appApi.version()).toBe('0.4.0');
    expect(appApi.platform()).toBe(process.platform);
  });

  it('writes text to clipboard', () => {
    const res = appApi.writeClipboard({ text: 'test-text' });
    expect(res).toEqual({ success: true });
    expect(clipboardText).toBe('test-text');
  });

  it('executes edit commands on focused webContents after focusing', () => {
    for (const cmd of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const) {
      const res = appApi.editCommand({ command: cmd });
      expect(res).toEqual({ success: true });
      expect(webContentsMock.focus).toHaveBeenCalled();
      expect(webContentsMock[cmd]).toHaveBeenCalled();
    }
  });

  it('returns error when no active window exists', () => {
    focusedWindow = null;
    const res = appApi.editCommand({ command: 'undo' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No active window');
  });
});
