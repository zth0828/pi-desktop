import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'node:events';

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockDetect = vi.fn();
vi.mock('../../electron/utils/pi-detector', () => ({
  detectPiEnvironment: () => mockDetect(),
  needsWindowsCommandShell: (p: string) => /\.(?:cmd|bat)$/i.test(p),
}));

vi.mock('../../electron/services/pi-adapter', () => ({
  loadPiAdapter: vi.fn(),
}));

import { mcpApi } from '../../electron/services/mcp-api';

describe('mcpApi.installAdapter', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockDetect.mockReset();
  });
  it('在 Windows 上遇到 .cmd shim 时以 shell: true 和 binPath 目录作为 cwd 启动', async () => {
    mockDetect.mockResolvedValue({
      pi: { found: true, binPath: 'C:\\Users\\test\\AppData\\Roaming\\npm\\pi.cmd' },
    });

    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mockSpawn.mockReturnValue(child);

    const promise = mcpApi.installAdapter();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSpawn).toHaveBeenCalledWith(
      'pi.cmd',
      ['install', 'npm:pi-mcp-adapter'],
      expect.objectContaining({
        shell: true,
        cwd: 'C:\\Users\\test\\AppData\\Roaming\\npm',
        windowsHide: true,
      }),
    );

    child.emit('close', 0);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('在 POSIX 上遇到标准可执行文件时不使用 shell', async () => {
    mockDetect.mockResolvedValue({
      pi: { found: true, binPath: '/usr/local/bin/pi' },
    });

    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mockSpawn.mockReturnValue(child);

    const promise = mcpApi.installAdapter();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/pi',
      ['install', 'npm:pi-mcp-adapter'],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
      }),
    );

    child.emit('close', 0);
    const result = await promise;
    expect(result.success).toBe(true);
  });
});
