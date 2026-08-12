import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceEntry,
  WorkspaceListPayload,
  WorkspaceListResult,
  WorkspaceReadPayload,
  WorkspaceReadResult,
} from '@shared/host-api/contract';
import { resolveWorkspacePath } from '../utils/workspace-path';
import { normalizePreviewablePath } from '../utils/previewable-files';
import { getActiveRuntime } from './pi-runtime-api';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx']);
const SPREADSHEET_TEXT_EXTENSIONS = new Set(['.csv', '.tsv']);
const BINARY_PREVIEW: Record<string, { kind: WorkspaceReadResult['kind']; mimeType: string }> = {
  '.pdf': { kind: 'pdf', mimeType: 'application/pdf' },
  '.docx': { kind: 'document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { kind: 'spreadsheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
};

function activeRoot(): string {
  const runtime = getActiveRuntime();
  if (!runtime) throw new Error('session not started');
  return runtime.cwd;
}

/**
 * 相对路径始终限制在当前工作区。绝对路径只有在 pi 本次 runtime 的 read/edit/write
 * 工具调用里真实出现过时才允许预览，避免 Renderer 通过 IPC 任意读取本机文件。
 */
async function resolvePreviewFile(pathValue: string): Promise<string> {
  const runtime = getActiveRuntime();
  if (!runtime) throw new Error('session not started');
  const root = await realpath(runtime.cwd);
  if (!path.isAbsolute(pathValue)) return resolveWorkspacePath(root, pathValue);
  const candidate = normalizePreviewablePath(pathValue);
  if (!runtime.previewableExternalFiles.has(candidate)) {
    throw new Error('file is outside the active workspace and was not produced by this session');
  }
  return realpath(candidate);
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
      entries.push({
        name: child.name,
        path: relativePath(root, absolute),
        kind: child.isDirectory() ? 'directory' : 'file',
      });
    }
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1,
    );
    return { path: relativePath(root, dir), entries };
  },

  readFile: async (payload: WorkspaceReadPayload): Promise<WorkspaceReadResult> => {
    const file = await resolvePreviewFile(payload.path);
    const stat = await lstat(file);
    if (!stat.isFile()) throw new Error('path is not a file');
    const extension = path.extname(file).toLowerCase();
    const mimeType = IMAGE_MIME[extension];
    if (mimeType) {
      if (stat.size > MAX_IMAGE_BYTES) {
        return { path: payload.path, absolutePath: file, name: path.basename(file), size: stat.size, kind: 'image', mimeType, truncated: true };
      }
      const buffer = await readFile(file);
      return {
        path: payload.path,
        absolutePath: file,
        name: path.basename(file),
        size: stat.size,
        kind: 'image',
        mimeType,
        data: buffer.toString('base64'),
        truncated: false,
      };
    }
    const binaryPreview = BINARY_PREVIEW[extension];
    if (binaryPreview) {
      if (stat.size > MAX_DOCUMENT_BYTES) {
        return {
          path: payload.path,
          absolutePath: file,
          name: path.basename(file),
          size: stat.size,
          kind: binaryPreview.kind,
          mimeType: binaryPreview.mimeType,
          truncated: true,
        };
      }
      const buffer = await readFile(file);
      return {
        path: payload.path,
        absolutePath: file,
        name: path.basename(file),
        size: stat.size,
        kind: binaryPreview.kind,
        mimeType: binaryPreview.mimeType,
        data: buffer.toString('base64'),
        truncated: false,
      };
    }
    const handle = await open(file, 'r');
    const previewSize = Math.min(stat.size, MAX_TEXT_BYTES + 1);
    const buffer = Buffer.alloc(previewSize);
    let bytesRead = 0;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, previewSize, 0));
    } finally {
      await handle.close();
    }
    const preview = buffer.subarray(0, bytesRead);
    if (looksBinary(preview)) {
      return { path: payload.path, absolutePath: file, name: path.basename(file), size: stat.size, kind: 'binary', truncated: false };
    }
    return {
      path: payload.path,
      absolutePath: file,
      name: path.basename(file),
      size: stat.size,
      kind: MARKDOWN_EXTENSIONS.has(extension)
        ? 'markdown'
        : SPREADSHEET_TEXT_EXTENSIONS.has(extension)
          ? 'spreadsheet'
          : 'text',
      text: preview.subarray(0, MAX_TEXT_BYTES).toString('utf8'),
      truncated: stat.size > MAX_TEXT_BYTES,
    };
  },
};
