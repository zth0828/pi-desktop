import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { formatErrorMessage } from '@/lib/error-formatter';
import { SESSION_REPLACEMENT_TIMEOUT } from '@/lib/session-binding';
import zh from '@shared/i18n/locales/zh/translation.json';
import en from '@shared/i18n/locales/en/translation.json';

// 初始化 i18next 用于单元测试
const i18nInstance = i18next.createInstance();
await i18nInstance.init({
  lng: 'zh',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
});

const tZh = i18nInstance.getFixedT('zh');
const tEn = i18nInstance.getFixedT('en');

describe('error-formatter（错误信息本地化转译）', () => {
  it('undefined 或空字符串返回 undefined', () => {
    expect(formatErrorMessage(undefined, tZh)).toBeUndefined();
    expect(formatErrorMessage('', tZh)).toBeUndefined();
  });

  it('转译 SESSION_REPLACEMENT_TIMEOUT 哨兵值', () => {
    expect(formatErrorMessage(SESSION_REPLACEMENT_TIMEOUT, tZh)).toBe(
      '会话替换超时未确认，请重试或切换会话。',
    );
    expect(formatErrorMessage(SESSION_REPLACEMENT_TIMEOUT, tEn)).toBe(
      'Session replacement timed out without confirmation. Please retry or switch sessions.',
    );
  });

  it('转译通道级通信超时 Host request timed out', () => {
    const rawTimeout = 'Host request timed out after 30000ms: piSessions.switch';
    expect(formatErrorMessage(rawTimeout, tZh)).toBe('与主进程通信超时（piSessions.switch），请重试。');
    expect(formatErrorMessage(rawTimeout, tEn)).toBe(
      'Main-process communication timed out (piSessions.switch). Please retry.',
    );
  });

  it('转译启动超时 start-timeout', () => {
    expect(formatErrorMessage('start-timeout', tZh)).toBe(tZh('chat.startTimeout'));
    expect(formatErrorMessage('start-timeout', tEn)).toBe(tEn('chat.startTimeout'));
  });

  it('转译 session not started', () => {
    expect(formatErrorMessage('session not started', tZh)).toBe(
      '会话未启动或已失效，请重试或新建会话。',
    );
    expect(formatErrorMessage('session not started', tEn)).toBe(
      'Session not started or has expired. Please retry or start a new session.',
    );
  });

  it('转译常见后端运行时与会话错误码', () => {
    const testCases = [
      'session is running',
      'session is streaming',
      'session is compacting',
      'session has no file',
      'project has a running session',
      'empty name',
      'empty source',
      'queue index out of range',
      'cancelled',
      'cannot create',
      'package source not found',
      'pi not found',
      'pi is not installed',
      'install timed out',
      'running',
      'not a git repository',
      'dirty',
      'bash already running',
      'command or url required',
      'conflicted files cannot be reverted from Review',
      'no changes to revert',
      'empty patch',
      'file-not-found',
      'file is outside the active workspace and was not produced by this session',
      'no workspace for project scope',
      'model refresh timed out',
      'fork produced no session file',
      'No downloaded installer',
      'No active window',
      'Failed to create image from buffer',
      'invalid name',
      'Invalid package name',
      'UI not available',
      'prompt preflight rejected',
      'Skill file does not exist',
      'Skill file is read-only',
      'skill import failed',
      'skill source is unavailable or unsafe',
      'Checksum mismatch',
      'No stable release found',
      'RUNNING_SESSIONS',
      'aborted',
      'Request aborted',
      'request aborted',
      'The user aborted a request.',
      'The operation was aborted',
      'BodyStreamBuffer was aborted',
      'Nothing to export yet - start a conversation first',
      'Cannot export in-memory session to HTML',
      'Cannot clone session: no current entry selected',
      'Session name cannot be empty',
      'path is not a directory',
      'path is not a file',
      'git empty tree failed',
    ];

    for (const code of testCases) {
      const zhText = formatErrorMessage(code, tZh);
      const enText = formatErrorMessage(code, tEn);
      expect(zhText, `zh translation for ${code}`).toBeDefined();
      expect(zhText, `zh translation for ${code}`).not.toBe(code);
      expect(enText, `en translation for ${code}`).toBeDefined();
      expect(enText, `en translation for ${code}`).not.toBe(code);
    }
  });

  it('转译动态参数错误（model not found, provider already exists 等）', () => {
    expect(formatErrorMessage('model not found: anthropic/claude-3-5-sonnet', tZh)).toBe(
      '未找到模型：anthropic/claude-3-5-sonnet',
    );
    expect(formatErrorMessage('model not found: anthropic/claude-3-5-sonnet', tEn)).toBe(
      'Model not found: anthropic/claude-3-5-sonnet',
    );

    expect(formatErrorMessage('custom provider not found: custom-open-ai', tZh)).toBe(
      '未找到供应商：custom-open-ai',
    );
    expect(formatErrorMessage('custom provider not found: custom-open-ai', tEn)).toBe(
      'Provider not found: custom-open-ai',
    );

    expect(formatErrorMessage('provider id already exists: my-provider', tZh)).toBe(
      '供应商 ID 已存在：my-provider',
    );
    expect(formatErrorMessage('provider id already exists: my-provider', tEn)).toBe(
      'Provider ID already exists: my-provider',
    );

    expect(formatErrorMessage('Download failed (404)', tZh)).toBe('下载失败（状态码 404）');
    expect(formatErrorMessage('Download failed (404)', tEn)).toBe('Download failed (status 404)');

    expect(formatErrorMessage('entry not found: entry-12345', tZh)).toBe('未找到记录：entry-12345');
    expect(formatErrorMessage('entry not found: entry-12345', tEn)).toBe('Entry not found: entry-12345');

    expect(formatErrorMessage('AbortError: Request aborted', tZh)).toBe('请求已中止。');
    expect(formatErrorMessage('AbortError: Request aborted', tEn)).toBe('Request aborted.');
  });

  it('转译工作区安全错误', () => {
    expect(formatErrorMessage('risky-workspace-home', tZh)).toBe(tZh('chat.workspace.riskyHome'));
    expect(formatErrorMessage('risky-workspace-root', tZh)).toBe(tZh('chat.workspace.riskyRoot'));
  });

  it('未识别的自定义错误原样透传', () => {
    const customError = 'Custom gateway error 502 Bad Gateway';
    expect(formatErrorMessage(customError, tZh)).toBe(customError);
  });
});
