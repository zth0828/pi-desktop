import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceEntry,
  WorkspaceListPayload,
  WorkspaceListResult,
  WorkspaceReadPayload,
  WorkspaceReadResult,
} from '@shared/host-api/contract';
import { resolveWorkspacePath } from '../utils/workspace-path';
import { getActiveRuntime } from './pi-runtime-api';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

function activeRoot(): string {
  const runtime = getActiveRuntime();
  if (!runtime) throw new Error('session not started');
  return runtime.cwd;
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export const workspaceApi = {
  listChildren: async (payload: WorkspaceListPayload): Promise<WorkspaceListResult> => {
    const root = await realpath(activeRoot());
    const dir = await resolveWorkspacePath(root, payload.path ?? '');
    if (!(await lstat(dir)).isDirectory()) throw new Error('path is not a directory');
    const children = await readdir(dir, { withFileTypes: true });
    const entries: WorkspaceEntry[] = [];
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory() && EXCLUDED_DIRS.has(child.name)) continue;
      if (!child.isDirectory() && !child.isFile()) continue;
      const absolute = path.join(dir, child.name);
      const stat = child.isFile() ? await lstat(absolute) : null;
      entries.push({
        name: child.name,
        path: relativePath(root, absolute),
        kind: child.isDirectory() ? 'directory' : 'file',
        ...(stat ? { size: stat.size } : {}),
      });
    }
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1,
    );
    return { path: relativePath(root, dir), entries };
  },

  readFile: async (payload: WorkspaceReadPayload): Promise<WorkspaceReadResult> => {
    const root = await realpath(activeRoot());
    const file = await resolveWorkspacePath(root, payload.path);
    const stat = await lstat(file);
    if (!stat.isFile()) throw new Error('path is not a file');
    const mimeType = IMAGE_MIME[path.extname(file).toLowerCase()];
    if (mimeType) {
      if (stat.size > MAX_IMAGE_BYTES) {
        return { path: payload.path, name: path.basename(file), size: stat.size, kind: 'image', mimeType, truncated: true };
      }
      const buffer = await readFile(file);
      return {
        path: payload.path,
        name: path.basename(file),
        size: stat.size,
        kind: 'image',
        mimeType,
        data: buffer.toString('base64'),
        truncated: false,
      };
    }
    const buffer = await readFile(file);
    if (looksBinary(buffer)) {
      return { path: payload.path, name: path.basename(file), size: stat.size, kind: 'binary', truncated: false };
    }
    return {
      path: payload.path,
      name: path.basename(file),
      size: stat.size,
      kind: 'text',
      text: buffer.subarray(0, MAX_TEXT_BYTES).toString('utf8'),
      truncated: buffer.length > MAX_TEXT_BYTES,
    };
  },
};
