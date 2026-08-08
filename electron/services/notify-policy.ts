// 通知档位判定（纯函数，与 electron 解耦，便于单测）。
import type { NotifyKind, SettingsSnapshot } from '@shared/host-api/contract';

export type NotifyMode = NonNullable<SettingsSnapshot['notifyMode']>;

/**
 * off 永不；always 总是；unfocused（默认）仅窗口失焦时。
 * kind='uiRequest'（扩展确认/输入请求）额外受 notifyUiRequest 开关控制（默认开）；
 * run 完成通知只看档位。
 */
export function shouldNotify(
  mode: NotifyMode | undefined,
  focused: boolean,
  kind?: NotifyKind,
  notifyUiRequest?: boolean,
): boolean {
  if (kind === 'uiRequest' && notifyUiRequest === false) return false;
  const effective = mode ?? 'unfocused';
  if (effective === 'off') return false;
  if (effective === 'always') return true;
  return !focused;
}
