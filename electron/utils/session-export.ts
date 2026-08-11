import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

const EXPORT_FOLDER_SEGMENTS = ['Pi Desktop', 'Exports'] as const;

export function sessionExportDirectory(): string {
  return path.join(app.getPath('documents'), ...EXPORT_FOLDER_SEGMENTS);
}

export async function ensureSessionExportDirectory(): Promise<string> {
  const directory = sessionExportDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function sessionExportPath(sessionFile: string): Promise<string> {
  const directory = await ensureSessionExportDirectory();
  const sessionName = path.basename(sessionFile, path.extname(sessionFile));
  return path.join(directory, `pi-session-${sessionName}.html`);
}
