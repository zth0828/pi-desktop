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
let clipboardImage: unknown = null;
const writtenFiles: Record<string, Buffer> = {};

vi.mock('node:fs', () => ({
  promises: {
    writeFile: vi.fn(async (filePath: string, buffer: Buffer) => {
      writtenFiles[filePath] = buffer;
    }),
  },
  readFileSync: vi.fn(() => JSON.stringify({ version: '0.4.0' })),
}));

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
    writeImage: (image: unknown) => {
      clipboardImage = image;
    },
  },
  nativeImage: {
    createFromBuffer: (buffer: Buffer) => ({
      isEmpty: () => buffer.length === 0,
      toDataURL: () => `data:image/png;base64,${buffer.toString('base64')}`,
    }),
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
    clipboardImage = null;
    for (const key of Object.keys(writtenFiles)) delete writtenFiles[key];
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

  it('writes image to clipboard', () => {
    const base64Data = Buffer.from('fake-image-bytes').toString('base64');
    const res = appApi.writeClipboardImage({ data: base64Data, mimeType: 'image/png' });
    expect(res.success).toBe(true);
    expect(clipboardImage).not.toBeNull();
  });

  it('returns error when writing empty image to clipboard', () => {
    const res = appApi.writeClipboardImage({ data: '', mimeType: 'image/png' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Failed to create image from buffer');
  });

  it('writes binary file to disk', async () => {
    const base64Data = Buffer.from('hello-binary').toString('base64');
    const res = await appApi.writeBinaryFile({ path: '/tmp/test.png', data: base64Data });
    expect(res.success).toBe(true);
    expect(writtenFiles['/tmp/test.png']?.toString('utf8')).toBe('hello-binary');
  });
});
