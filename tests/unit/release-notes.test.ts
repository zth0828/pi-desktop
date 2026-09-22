import { describe, expect, it } from 'vitest';
import { sanitizeReleaseNotes } from '../../shared/release-notes';

describe('sanitizeReleaseNotes', () => {
  it('handles null, undefined, or empty string', () => {
    expect(sanitizeReleaseNotes(null)).toBe('');
    expect(sanitizeReleaseNotes(undefined)).toBe('');
    expect(sanitizeReleaseNotes('')).toBe('');
    expect(sanitizeReleaseNotes('   ')).toBe('');
  });

  it('keeps clean release notes without download sections unchanged', () => {
    const raw = '### Pi Desktop v1.4.4\n- Windows & macOS 增量热更新在线测试\n- 消除子进程黑框弹窗';
    expect(sanitizeReleaseNotes(raw)).toBe(raw);
  });

  it('strips download section bounded by horizontal rules', () => {
    const raw = [
      '### 📥 下载地址 (Download)',
      '',
      '#### 🪟 Windows (不支持 Win7)',
      '- **标准安装版**：[Windows 64位安装包](https://example.com/app.exe)',
      '',
      '#### 🍏 macOS (macOS 11.0+)',
      '- **Apple M芯片**：[Apple M芯片 DMG](https://example.com/app.dmg)',
      '',
      '---',
      '',
      '## 核心特性与改进',
      '',
      '- 新增伴侣扩展支持',
      '- 优化会话导航轨',
    ].join('\n');

    const cleaned = sanitizeReleaseNotes(raw);
    expect(cleaned).not.toContain('下载地址');
    expect(cleaned).not.toContain('Apple M芯片');
    expect(cleaned).toContain('## 核心特性与改进');
    expect(cleaned).toContain('- 新增伴侣扩展支持');
  });

  it('returns empty string if release note only contained download section', () => {
    const raw = [
      '### 📥 下载地址 (Download)',
      '',
      '#### 🪟 Windows',
      '- [Windows Setup](https://example.com/app.exe)',
    ].join('\n');

    expect(sanitizeReleaseNotes(raw)).toBe('');
  });

  it('strips English Downloads section heading without horizontal rules', () => {
    const raw = [
      '## 📥 Downloads',
      '',
      '- [Mac Installer](https://example.com/app.dmg)',
      '- [Windows Installer](https://example.com/app.exe)',
      '',
      '## What is New',
      '',
      '- Added support for companion extensions',
    ].join('\n');

    const cleaned = sanitizeReleaseNotes(raw);
    expect(cleaned).not.toContain('Downloads');
    expect(cleaned).not.toContain('Mac Installer');
    expect(cleaned).toContain('## What is New');
    expect(cleaned).toContain('- Added support for companion extensions');
  });
});
