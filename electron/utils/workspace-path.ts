import { realpath } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_DEVICE_PATH_REGEX = /^(?:[\\/]{2}\.?[\\/]|(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$))/i;

export function isWindowsDevicePath(p: string): boolean {
  return WINDOWS_DEVICE_PATH_REGEX.test(p) || p.startsWith('\\\\.\\') || p.startsWith('\\\\?\\');
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** Resolve an existing path without permitting lexical or symlink escapes. */
export async function resolveWorkspacePath(root: string, relativePath = ''): Promise<string> {
  if (path.isAbsolute(relativePath)) throw new Error('absolute paths are not allowed');
  if (isWindowsDevicePath(relativePath)) throw new Error('device paths are not allowed');
  const rootReal = await realpath(root);
  const lexical = path.resolve(rootReal, relativePath || '.');
  if (!isInside(rootReal, lexical)) throw new Error('path escapes workspace');
  const resolved = await realpath(lexical);
  if (!isInside(rootReal, resolved)) throw new Error('path escapes workspace');
  return resolved;
}
