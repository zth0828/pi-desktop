import { describe, expect, it } from 'vitest';
import {
  detectSlashToken,
  SHELL_BUILTIN_NAMES,
} from '@/pages/Chat/chat-input/types';

describe('slash command token detection & guard', () => {
  it('detects slash tokens at start of input and after whitespace', () => {
    expect(detectSlashToken('/model', 6)).toEqual({ start: 0, end: 6, query: 'model' });
    expect(detectSlashToken('/m', 2)).toEqual({ start: 0, end: 2, query: 'm' });
    expect(detectSlashToken('/', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(detectSlashToken('hello /settings', 15)).toEqual({ start: 6, end: 15, query: 'settings' });
  });

  it('supports fullwidth slash ／ in token detection', () => {
    expect(detectSlashToken('／model', 6)).toEqual({ start: 0, end: 6, query: 'model' });
    expect(detectSlashToken('／ada', 4)).toEqual({ start: 0, end: 4, query: 'ada' });
  });

  it('contains all shell built-in commands', () => {
    const requiredBuiltins = [
      'new',
      'tree',
      'compact',
      'model',
      'name',
      'copy',
      'export',
      'session',
      'settings',
      'skills',
      'extensions',
      'mcp',
      'models',
      'login',
      'logout',
      'reload',
      'resume',
    ];
    for (const name of requiredBuiltins) {
      expect(SHELL_BUILTIN_NAMES.has(name)).toBe(true);
    }
  });

  it('rejects unrecognized commands from shell builtins', () => {
    expect(SHELL_BUILTIN_NAMES.has('m')).toBe(false);
    expect(SHELL_BUILTIN_NAMES.has('mo')).toBe(false);
    expect(SHELL_BUILTIN_NAMES.has('se')).toBe(false);
    expect(SHELL_BUILTIN_NAMES.has('sk')).toBe(false);
    expect(SHELL_BUILTIN_NAMES.has('ada')).toBe(false);
    expect(SHELL_BUILTIN_NAMES.has('aaa')).toBe(false);
  });
});
