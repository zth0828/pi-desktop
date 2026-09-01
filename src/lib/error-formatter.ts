import type { TFunction } from 'i18next';
import { matchHostInvokeTimeout } from './host-api-client';
import { SESSION_REPLACEMENT_TIMEOUT } from './session-binding';

const KNOWN_ERROR_KEYS: Record<string, string> = {
  'session not started': 'sessionNotStarted',
  'session is running': 'sessionIsRunning',
  'session is streaming': 'sessionIsStreaming',
  'session is compacting': 'sessionIsCompacting',
  'session has no file': 'sessionHasNoFile',
  'project has a running session': 'projectHasRunningSession',
  'empty name': 'emptyName',
  'empty source': 'emptySource',
  'queue index out of range': 'queueIndexOutOfRange',
  'cancelled': 'cancelled',
  'cannot create': 'cannotCreate',
  'package source not found': 'packageSourceNotFound',
  'pi not found': 'piNotFound',
  'pi is not installed': 'piNotInstalled',
  'install timed out': 'installTimeout',
  'running': 'running',
  'not a git repository': 'notGitRepo',
  'dirty': 'gitDirty',
};

/**
 * 把主进程、通信通道及运行时返回的各类错误统一转译为用户可见的本地化文案。
 * 覆盖：
 * 1. 替换等待超时（SESSION_REPLACEMENT_TIMEOUT）
 * 2. 启动超时（start-timeout）
 * 3. IPC 通信超时（matchHostInvokeTimeout）
 * 4. 工作区安全限制（risky-workspace-*）
 * 5. 后端固定错误码（session not started 等）
 * 6. 未知错误原样透传
 */
export function formatErrorMessage(error: string | undefined, t: TFunction): string | undefined {
  if (!error) return undefined;
  if (error === SESSION_REPLACEMENT_TIMEOUT) return t('chat.errors.replacementTimeout');
  if (error === 'start-timeout') return t('chat.startTimeout');
  if (error === 'risky-workspace-home') return t('chat.workspace.riskyHome');
  if (error === 'risky-workspace-root') return t('chat.workspace.riskyRoot');

  const timeoutAction = matchHostInvokeTimeout(error);
  if (timeoutAction) {
    return t('chat.errors.hostInvokeTimeout', { action: timeoutAction });
  }

  const key = KNOWN_ERROR_KEYS[error];
  if (key) {
    return t(`chat.errors.${key}`);
  }

  return error;
}
