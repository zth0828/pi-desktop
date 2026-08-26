import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { stripAttachmentEnvelope } from '@shared/message-attachments';

const EXPORT_FOLDER_SEGMENTS = ['Pi Desktop', 'Exports'] as const;

export function sanitizePathSegment(segment: string, fallback = 'default'): string {
  const sanitized = segment
    .replace(/[<>:"/\\|?*\x00-\x1f\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return sanitized || fallback;
}

export function projectFolderName(cwd?: string): string {
  if (!cwd) return 'default';
  const name = cwd.split(/[\\/]/).filter(Boolean).pop();
  return sanitizePathSegment(name ?? 'default', 'default');
}

/** 导出会话的根目录（~/Documents/Pi Desktop/Exports） */
export function sessionExportRootDirectory(): string {
  return path.join(app.getPath('documents'), ...EXPORT_FOLDER_SEGMENTS);
}

/** 某项目工作区的会话导出目录（按项目名称隔离，缺省返回根目录） */
export function sessionExportDirectory(cwd?: string): string {
  const root = sessionExportRootDirectory();
  if (!cwd) return root;
  return path.join(root, projectFolderName(cwd));
}

export async function ensureSessionExportDirectory(cwd?: string): Promise<string> {
  const directory = sessionExportDirectory(cwd);
  await mkdir(directory, { recursive: true });
  return directory;
}

export type SessionExportTargetOptions = {
  sessionFile: string;
  cwd?: string;
  title?: string;
  id?: string;
};

export async function sessionExportPath(
  options: string | SessionExportTargetOptions,
): Promise<string> {
  const opts: SessionExportTargetOptions = typeof options === 'string'
    ? { sessionFile: options }
    : options;

  const directory = await ensureSessionExportDirectory(opts.cwd);
  const baseName = path.basename(opts.sessionFile, path.extname(opts.sessionFile));

  // 提取创建日期与短 ID
  // 标准命名：2026-08-22T20-44-15-718Z_01a02b37-8be6-71c8-9f73-72160c75bd76
  const dateMatch = baseName.match(/^(\d{4}-\d{2}-\d{2})/);
  const dateStr = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

  const rawId = opts.id ?? baseName.split('_').pop()?.replace(/\.jsonl$/, '') ?? baseName;
  const shortId = rawId.slice(0, 8);

  const rawTitle = opts.title ? stripAttachmentEnvelope(opts.title) : '';
  const cleanTitle = sanitizePathSegment(rawTitle.slice(0, 50), '');

  const fileName = cleanTitle
    ? `${cleanTitle}_${dateStr}_${shortId}.html`
    : `pi-session-${dateStr}_${shortId}.html`;

  return path.join(directory, fileName);
}
