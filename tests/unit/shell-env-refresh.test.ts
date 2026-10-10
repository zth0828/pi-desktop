import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { _resetUserPathCache, probeWindowsNodePaths, refreshUserPath, resolveUserPath } from '../../electron/utils/shell-env';

describe('shell-env refresh', () => {
  const originalEnvPath = process.env.PATH;
  const originalUserPath = process.env.PI_DESKTOP_USER_PATH;

  beforeEach(() => {
    _resetUserPathCache();
  });

  afterEach(() => {
    process.env.PATH = originalEnvPath;
    if (originalUserPath !== undefined) {
      process.env.PI_DESKTOP_USER_PATH = originalUserPath;
    } else {
      delete process.env.PI_DESKTOP_USER_PATH;
    }
    _resetUserPathCache();
  });

  it('honors PI_DESKTOP_USER_PATH override', () => {
    process.env.PI_DESKTOP_USER_PATH = '/custom/test/path';
    expect(resolveUserPath()).toBe('/custom/test/path');
  });

  it('refreshUserPath clears cache and re-resolves', () => {
    process.env.PI_DESKTOP_USER_PATH = '/initial/path';
    expect(resolveUserPath()).toBe('/initial/path');

    process.env.PI_DESKTOP_USER_PATH = '/updated/path';
    expect(resolveUserPath()).toBe('/initial/path');

    expect(refreshUserPath()).toBe('/updated/path');
  });

  it('probeWindowsNodePaths 不将当前目录 "." 或空串混入 PATH 探测列表', () => {
    const paths = probeWindowsNodePaths();
    expect(paths).not.toContain('.');
    expect(paths.every((p) => p !== '' && p !== '.')).toBe(true);
  });
});
