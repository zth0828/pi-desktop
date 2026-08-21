import type { TFunction } from 'i18next';

/** 把 main 侧工作区安全错误码翻译成用户可见文案；非错误码原样透传。 */
export function workspaceErrorMessage(error: string | undefined, t: TFunction): string | undefined {
  if (!error) return undefined;
  if (error === 'risky-workspace-home') return t('chat.workspace.riskyHome');
  if (error === 'risky-workspace-root') return t('chat.workspace.riskyRoot');
  return error;
}
