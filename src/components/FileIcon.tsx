import type { CSSProperties, ReactNode } from 'react';
import { getFileBadgeText } from '../lib/file-badge';

export { getFileBadgeText };

export interface FileIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Material Icon Theme 风格高辨识度矢量图标组件
 */
export function FileIcon({ name, size = 16, className = '', style }: FileIconProps) {
  const lower = name.toLowerCase().trim();
  const base = lower.split('/').pop()?.split('\\').pop() ?? lower;
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : '';

  const renderIcon = (): ReactNode => {
    // 1. 特殊文件名优先匹配
    if (base === 'dockerfile' || base.startsWith('docker-compose')) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <path d="M29.5 15.2c-.4-.3-1.4-.4-2.2-.2-.2-.6-.5-1.1-1-1.6l-.6.4c-.4.3-.8.7-1.1 1.1-.9-.5-2.2-.6-3.3-.1l-.3.2V13h-3v-3h-3v3h-3v-3H9v3H6v-3H3v6c-1.7 1.1-2 3.5-2 5.5C1 26 5.5 29 14.5 29c8.2 0 13.5-3.3 14.8-8.7.8-.1 2.5-.7 2.7-2.6 0-.8-.5-1.9-2.5-2.5z" fill="#2496ed" />
        </svg>
      );
    }
    if (base.startsWith('.env')) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#f59e0b" strokeWidth="2" className={className} style={style}>
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 3 3L22 7l-3-3" />
        </svg>
      );
    }
    if (base.startsWith('.git')) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <path d="M30.5 14.5l-13-13a2.1 2.1 0 0 0-3 0l-2.6 2.6 3.3 3.3a2.5 2.5 0 0 1 3.2 3.2l3.2 3.2a2.5 2.5 0 1 1-1.5 1.5l-3-3v7.3a2.5 2.5 0 1 1-2.1 0v-7.5a2.5 2.5 0 0 1-1.3-3.2L10.3 5.7 1.5 14.5a2.1 2.1 0 0 0 0 3l13 13a2.1 2.1 0 0 0 3 0l13-13a2.1 2.1 0 0 0 0-3z" fill="#f05032" />
        </svg>
      );
    }
    if (base === 'package.json') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#cb3837" />
          <path d="M5 5h22v22H5V5zm4 4v14h7V9H9zm7 4h4v10h-4V13z" fill="#ffffff" />
        </svg>
      );
    }
    if (base === 'tsconfig.json' || base.startsWith('tsconfig.') || base === 'jsconfig.json') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#3178c6" />
          <path d="M14 13H7v-2h11v2h-4v10h-3V13zm6.5 7c1 1 2.2 1.5 3.6 1.5 1.8 0 2.8-.7 2.8-1.7 0-1-.6-1.5-2.2-1.9l-1-.3c-2-.6-3.2-1.6-3.2-3.5 0-2.3 1.9-3.6 4.6-3.6 1.7 0 3 .4 4 1.2l-1 1.8c-.8-.6-1.7-1-2.8-1-1.4 0-2.2.6-2.2 1.5 0 .8.5 1.3 1.9 1.7l1 .3c2.3.7 3.4 1.7 3.4 3.7 0 2.4-1.9 3.8-5 3.8-2.1 0-3.6-.6-4.7-1.7l1-2.1z" fill="#ffffff" />
        </svg>
      );
    }
    if (base.startsWith('vite.config.')) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <path d="M29.5 5.5L16.8 28.8a1 1 0 0 1-1.6 0L2.5 5.5a1 1 0 0 1 1-1.5l12.5 3 12.5-3a1 1 0 0 1 1 1.5z" fill="#bd34fe" />
          <path d="M19 3l-8.5 11h5.5l-3.5 11 11-13h-6.5L19 3z" fill="#ffd426" />
        </svg>
      );
    }
    if (base.endsWith('.lock') || base.endsWith('-lock.yaml') || base.endsWith('-lock.json')) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#94a3b8" strokeWidth="2" className={className} style={style}>
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    }

    // 2. 办公与常用文档
    if (['xlsx', 'xls', 'csv', 'tsv', 'numbers', 'xlsm', 'ods'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect x="3" y="4" width="26" height="24" rx="3" fill="#107c41" />
          <path d="M19 9h7v14h-7z" fill="#33c481" opacity="0.3" />
          <path d="M19 9h7v3h-7zm0 4h7v3h-7zm0 4h7v3h-7z" fill="#ffffff" opacity="0.5" />
          <rect x="3" y="7" width="16" height="18" rx="2" fill="#185a37" />
          <text x="11" y="21" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="14" fill="#ffffff" textAnchor="middle">X</text>
        </svg>
      );
    }
    if (['docx', 'doc', 'rtf', 'odt', 'pages'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect x="3" y="4" width="26" height="24" rx="3" fill="#185abd" />
          <path d="M19 9h7v14h-7z" fill="#4b92db" opacity="0.3" />
          <path d="M19 9h7v2h-7zm0 4h7v2h-7zm0 4h7v2h-7zm0 4h5v2h-5z" fill="#ffffff" opacity="0.6" />
          <rect x="3" y="7" width="16" height="18" rx="2" fill="#103f91" />
          <text x="11" y="21" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="13" fill="#ffffff" textAnchor="middle">W</text>
        </svg>
      );
    }
    if (['pptx', 'ppt', 'key', 'odp'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect x="3" y="4" width="26" height="24" rx="3" fill="#c43e1c" />
          <circle cx="22" cy="16" r="4" fill="#f37f58" />
          <path d="M22 16 L22 12 A4 4 0 0 1 26 16 Z" fill="#ffffff" opacity="0.8" />
          <rect x="3" y="7" width="16" height="18" rx="2" fill="#8d260c" />
          <text x="11" y="21" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="14" fill="#ffffff" textAnchor="middle">P</text>
        </svg>
      );
    }
    if (ext === 'pdf') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <path d="M6 3h13l7 7v19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#f43f5e" />
          <path d="M19 3v7h7" fill="#fda4af" />
          <rect x="5" y="15" width="22" height="10" rx="1.5" fill="#9f1239" opacity="0.9" />
          <text x="16" y="23" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="8.5" fill="#ffffff" textAnchor="middle" letterSpacing="1">PDF</text>
        </svg>
      );
    }
    if (['md', 'markdown', 'mdx'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect x="2" y="6" width="28" height="20" rx="3" fill="#0284c7" />
          <path d="M5 20V12h2.5l2.5 3 2.5-3H15v8h-2v-4.5l-2 2.5-2-2.5V20H5zm14-4v-4h2v4h2.5L20 19.5 16.5 16H19z" fill="#ffffff" />
        </svg>
      );
    }
    if (['txt', 'log', 'out', 'text'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#94a3b8" strokeWidth="2" className={className} style={style}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="14" y2="17" />
        </svg>
      );
    }

    // 3. 编程语言代码
    if (ext === 'tsx') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#3178c6" />
          <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#61dafb" strokeWidth="1.5" transform="rotate(30 16 16)" />
          <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#61dafb" strokeWidth="1.5" transform="rotate(90 16 16)" />
          <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#61dafb" strokeWidth="1.5" transform="rotate(150 16 16)" />
          <circle cx="16" cy="16" r="1.8" fill="#61dafb" />
        </svg>
      );
    }
    if (ext === 'ts') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#3178c6" />
          <path d="M14.5 13.5H7V11h11v2.5h-4.5v11h-3v-11zm5.2 7.7c1 1.2 2.4 1.8 4 1.8 2.2 0 3.3-.9 3.3-2.1 0-1.2-.8-1.8-2.6-2.3l-1.3-.4c-2.4-.7-3.8-1.9-3.8-4.2 0-2.8 2.3-4.4 5.6-4.4 2 0 3.5.5 4.7 1.5l-1.3 2.2c-.9-.8-2-1.2-3.4-1.2-1.7 0-2.7.8-2.7 1.9 0 1 .7 1.6 2.3 2.1l1.3.4c2.8.8 4.1 2 4.1 4.5 0 2.9-2.3 4.6-6.1 4.6-2.5 0-4.3-.7-5.6-2l1.6-2.4z" fill="#ffffff" />
        </svg>
      );
    }
    if (ext === 'jsx') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#f7df1e" />
          <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#222222" strokeWidth="1.5" transform="rotate(30 16 16)" />
          <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#222222" strokeWidth="1.5" transform="rotate(90 16 16)" />
          <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#222222" strokeWidth="1.5" transform="rotate(150 16 16)" />
          <circle cx="16" cy="16" r="1.8" fill="#222222" />
        </svg>
      );
    }
    if (['js', 'mjs', 'cjs'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#f7df1e" />
          <path d="M16.5 19.5c0 2.5-1.5 4.5-4.5 4.5-2.2 0-3.8-1.2-4.5-2.5l2.2-1.5c.5.8 1.2 1.5 2.2 1.5 1.1 0 1.8-.6 1.8-1.7V9.5h2.8v10zm6.5 1.5c1.2 0 2.2-.6 2.8-1.5l2.2 1.5c-1.1 1.8-2.9 2.8-5 2.8-3.5 0-5.8-2.3-5.8-5.8 0-3.3 2.3-5.8 5.8-5.8 3.5 0 5.5 2.3 5.5 5.5v.8h-8.5c.2 1.8 1.4 2.5 3 2.5z" fill="#222222" />
        </svg>
      );
    }
    if (['py', 'pyw', 'ipynb'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <path d="M15.9 3c-4.2 0-6.9.7-6.9 2.8v3.1h7v1h-9.8C3.8 9.9 2 11.8 2 16c0 4.1 1.7 6.1 4.2 6.1h2.5v-3.6c0-2.7 2.3-5 5-5h7c2.2 0 4-1.8 4-4V6.5c0-2.1-3.6-3.5-8.8-3.5zm-3.1 2.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" fill="#387eb8" />
          <path d="M16.1 29c4.2 0 6.9-.7 6.9-2.8v-3.1h-7v-1h9.8c2.4 0 4.2-1.9 4.2-6.1 0-4.1-1.7-6.1-4.2-6.1h-2.5v3.6c0 2.7-2.3 5-5 5h-7c-2.2 0-4 1.8-4 4v3c0 2.1 3.6 3.5 8.8 3.5zm3.1-2.2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" fill="#ffe052" />
        </svg>
      );
    }
    if (['rs', 'cargo.toml'].includes(ext) || base === 'cargo.toml') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#dea584" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="13" fill="#222222" textAnchor="middle">RS</text>
        </svg>
      );
    }
    if (ext === 'go' || base === 'go.mod') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#00add8" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="13" fill="#ffffff" textAnchor="middle">GO</text>
        </svg>
      );
    }
    if (['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#00599c" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="11" fill="#ffffff" textAnchor="middle">C++</text>
        </svg>
      );
    }
    if (['java', 'jar', 'kt', 'kts'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#ea580c" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="12" fill="#ffffff" textAnchor="middle">JAVA</text>
        </svg>
      );
    }
    if (ext === 'swift') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#f05138" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="11" fill="#ffffff" textAnchor="middle">SWIFT</text>
        </svg>
      );
    }
    if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#22c55e" strokeWidth="2" className={className} style={style}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    }
    if (['html', 'htm', 'xhtml'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#e34f26" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="13" fill="#ffffff" textAnchor="middle">&lt;&gt;</text>
        </svg>
      );
    }
    if (['css', 'scss', 'sass', 'less', 'styl'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#264de4" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="15" fill="#ffffff" textAnchor="middle">#</text>
        </svg>
      );
    }
    if (ext === 'vue') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <polygon points="16 26 2 4 8 4 16 17 24 4 30 4" fill="#41b883" />
          <polygon points="16 20 8 4 12 4 16 11 20 4 24 4" fill="#35495e" />
        </svg>
      );
    }
    if (ext === 'svelte') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#ff3e00" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="11" fill="#ffffff" textAnchor="middle">SVELTE</text>
        </svg>
      );
    }

    // 4. 配置与数据
    if (['json', 'json5', 'jsonc', 'jsonl'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#d97706" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="14" fill="#ffffff" textAnchor="middle">{'{ }'}</text>
        </svg>
      );
    }
    if (['yaml', 'yml', 'toml', 'ini', 'conf', 'config'].includes(ext)) {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#7c3aed" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="11" fill="#ffffff" textAnchor="middle">YML</text>
        </svg>
      );
    }
    if (['xml', 'plist'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#f59e0b" strokeWidth="2" className={className} style={style}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    }
    if (ext === 'svg') {
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style}>
          <rect width="32" height="32" rx="4" fill="#ec4899" />
          <text x="16" y="21" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="11" fill="#ffffff" textAnchor="middle">SVG</text>
        </svg>
      );
    }

    // 5. 数据库
    if (['sql', 'sqlite', 'db', 'prisma'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#06b6d4" strokeWidth="2" className={className} style={style}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    }

    // 6. 多媒体与归档
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tiff'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#ec4899" strokeWidth="2" className={className} style={style}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      );
    }
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#a855f7" strokeWidth="2" className={className} style={style}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    }
    if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#8b5cf6" strokeWidth="2" className={className} style={style}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="m9 8 6 4-6 4Z" fill="#8b5cf6" />
        </svg>
      );
    }
    if (['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'xz', 'zst'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#ca8a04" strokeWidth="2" className={className} style={style}>
          <path d="M10 2v20" />
          <path d="M14 2v20" />
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    }
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#0ea5e9" strokeWidth="2" className={className} style={style}>
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" y1="20" x2="15" y2="20" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      );
    }

    // 7. 通用未知文件兜底
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" className={className} style={style}>
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  };

  return <span className="file-icon-wrapper" data-testid="file-icon">{renderIcon()}</span>;
}
