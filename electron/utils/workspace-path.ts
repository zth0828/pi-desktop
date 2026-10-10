import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { stripWindowsExtendedPrefix } from './same-path';

const DOS_DEVICE_REGEX = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)(?:\.|$)/i;

export function isWindowsDevicePath(p: string): boolean {
  if (p.startsWith('\\\\.\\') || p.startsWith('\\\\?\\')) return true;
  const normalized = p.replace(/\\/g, '/');
  if (/^\/\/[.?]\//.test(normalized)) return true;
  const segments = normalized.split('/');
  return segments.some((seg) => DOS_DEVICE_REGEX.test(seg));
}

function isInside(root: string, candidate: string): boolean {
  const cleanRoot = stripWindowsExtendedPrefix(root);
  const cleanCandidate = stripWindowsExtendedPrefix(candidate);
  const rel = path.relative(cleanRoot, cleanCandidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** Resolve an existing path without permitting lexical or symlink escapes. */
export async function resolveWorkspacePath(root: string, relativePath = ''): Promise<string> {
  if (isWindowsDevicePath(relativePath)) throw new Error('device paths are not allowed');
  if (path.isAbsolute(relativePath)) throw new Error('absolute paths are not allowed');
  const rootReal = await realpath(root);
  const lexical = path.resolve(rootReal, relativePath || '.');
  if (!isInside(rootReal, lexical)) throw new Error('path escapes workspace');
  const resolved = await realpath(lexical);
  if (!isInside(rootReal, resolved)) throw new Error('path escapes workspace');
  return resolved;
}
