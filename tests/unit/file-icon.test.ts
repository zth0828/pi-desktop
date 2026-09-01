import { describe, expect, it } from 'vitest';
import { getFileBadgeText } from '../../src/lib/file-badge';

describe('getFileBadgeText', () => {
  it('正确解析常用文件大写角标', () => {
    expect(getFileBadgeText('report.xlsx')).toBe('XLSX');
    expect(getFileBadgeText('contract.docx')).toBe('DOCX');
    expect(getFileBadgeText('slides.pptx')).toBe('PPTX');
    expect(getFileBadgeText('doc.pdf')).toBe('PDF');
    expect(getFileBadgeText('README.md')).toBe('MD');
    expect(getFileBadgeText('README.markdown')).toBe('MD');
    expect(getFileBadgeText('app.tsx')).toBe('TSX');
    expect(getFileBadgeText('server.ts')).toBe('TS');
    expect(getFileBadgeText('script.py')).toBe('PY');
    expect(getFileBadgeText('photo.jpeg')).toBe('JPG');
  });

  it('正确解析特殊配置文件角标', () => {
    expect(getFileBadgeText('Dockerfile')).toBe('DOCKER');
    expect(getFileBadgeText('docker-compose.yml')).toBe('DOCKER');
    expect(getFileBadgeText('.env.local')).toBe('ENV');
    expect(getFileBadgeText('.gitignore')).toBe('GIT');
    expect(getFileBadgeText('package.json')).toBe('NPM');
    expect(getFileBadgeText('tsconfig.json')).toBe('TS');
    expect(getFileBadgeText('pnpm-lock.yaml')).toBe('LOCK');
  });

  it('处理无后缀或特殊路径', () => {
    expect(getFileBadgeText('src/components/Button.tsx')).toBe('TSX');
    expect(getFileBadgeText('/Users/user/LICENSE')).toBe('FILE');
  });
});
