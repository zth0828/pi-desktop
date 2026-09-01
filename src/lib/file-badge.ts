/**
 * 获取文件的大写精简扩展名标签（用于胶囊角标，如 XLSX, DOCX, TS, PDF 等）
 */
export function getFileBadgeText(name: string): string {
  const lower = name.toLowerCase().trim();
  const base = lower.split('/').pop()?.split('\\').pop() ?? lower;

  if (base === 'dockerfile' || base.startsWith('docker-compose')) return 'DOCKER';
  if (base.startsWith('.env')) return 'ENV';
  if (base.startsWith('.git')) return 'GIT';
  if (base === 'package.json') return 'NPM';
  if (base === 'tsconfig.json') return 'TS';
  if (base.endsWith('-lock.yaml') || base.endsWith('.lock')) return 'LOCK';

  const ext = base.split('.').pop() ?? '';
  if (!ext || ext === base) return 'FILE';
  if (ext === 'markdown') return 'MD';
  if (ext === 'jpeg') return 'JPG';
  if (ext === 'golang') return 'GO';
  return ext.toUpperCase().slice(0, 6);
}
