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
  'bash already running': 'bashAlreadyRunning',
  'command or url required': 'commandOrUrlRequired',
  'conflicted files cannot be reverted from Review': 'reviewConflictCannotRevert',
  'no changes to revert': 'reviewNoChanges',
  'empty patch': 'emptyPatch',
  'file-not-found': 'fileNotFound',
  'file is outside the active workspace and was not produced by this session': 'fileOutsideWorkspace',
  'no workspace for project scope': 'noWorkspaceForProject',
  'model refresh timed out': 'modelRefreshTimeout',
  'fork produced no session file': 'forkNoFile',
  'No downloaded installer': 'noDownloadedInstaller',
  'No active window': 'noActiveWindow',
  'Failed to create image from buffer': 'imageBufferFailed',
  'invalid name': 'invalidName',
  'Invalid package name': 'invalidPackageName',
  'UI not available': 'uiNotAvailable',
  'prompt preflight rejected': 'promptPreflightRejected',
  'Skill file does not exist': 'skillNotFound',
  'Skill file is read-only': 'skillReadOnly',
  'skill import failed': 'skillImportFailed',
  'skill source is unavailable or unsafe': 'skillUnsafe',
  'Checksum mismatch': 'checksumMismatch',
  'No stable release found': 'noStableRelease',
  'RUNNING_SESSIONS': 'runningSessions',
  'aborted': 'aborted',
  'Request aborted': 'requestAborted',
  'request aborted': 'requestAborted',
  'The user aborted a request.': 'aborted',
  'The operation was aborted': 'aborted',
  'BodyStreamBuffer was aborted': 'aborted',
  'Nothing to export yet - start a conversation first': 'nothingToExport',
  'Cannot export in-memory session to HTML': 'cannotExportInMemory',
  'Cannot clone session: no current entry selected': 'noCurrentEntry',
  'Session name cannot be empty': 'emptyName',
  'path is not a directory': 'notADirectory',
  'path is not a file': 'notAFile',
  'git empty tree failed': 'gitEmptyTreeFailed',
};

/**
 * 把主进程、通信通道及运行时返回的各类错误统一转译为用户可见的本地化文案。
 * 覆盖：
 * 1. 替换等待超时（SESSION_REPLACEMENT_TIMEOUT）
 * 2. 启动超时（start-timeout）
 * 3. IPC 通信超时（matchHostInvokeTimeout）
 * 4. 工作区安全限制（risky-workspace-*）
 * 5. 后端固定错误码（session not started、bash already running 等）
 * 6. 动态模板错误（model not found、custom provider not found 等）
 * 7. 未知错误原样透传
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

  const modelMatch = error.match(/^model not found:\s*(.+)$/i);
  if (modelMatch) {
    return t('chat.errors.modelNotFound', {
      model: modelMatch[1],
      interpolation: { escapeValue: false },
    });
  }

  const providerNotFoundMatch = error.match(/^custom provider not found:\s*(.+)$/i);
  if (providerNotFoundMatch) {
    return t('chat.errors.providerNotFound', {
      id: providerNotFoundMatch[1],
      interpolation: { escapeValue: false },
    });
  }

  const providerExistsMatch = error.match(/^provider id already exists:\s*(.+)$/i);
  if (providerExistsMatch) {
    return t('chat.errors.providerAlreadyExists', {
      id: providerExistsMatch[1],
      interpolation: { escapeValue: false },
    });
  }

  const downloadFailedMatch = error.match(/^Download failed\s*\((\d+)\)$/i);
  if (downloadFailedMatch) {
    return t('chat.errors.downloadFailed', {
      status: downloadFailedMatch[1],
      interpolation: { escapeValue: false },
    });
  }

  const abortMatch = error.match(/^(?:aborterror:\s*)?(?:request aborted|the user aborted a request\.?|the operation was aborted\.?|operation aborted\.?)$/i);
  if (abortMatch) {
    return t('chat.errors.requestAborted');
  }

  const entryNotFoundMatch = error.match(/^entry not found:\s*(.+)$/i);
  if (entryNotFoundMatch) {
    return t('chat.errors.entryNotFound', {
      entry: entryNotFoundMatch[1],
      interpolation: { escapeValue: false },
    });
  }

  return error;
}
