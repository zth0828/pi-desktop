// 通知档位判定（纯函数，与 electron 解耦，便于单测）。
import type { SettingsSnapshot } from '@shared/host-api/contract';

export type NotifyMode = NonNullable<SettingsSnapshot['notifyMode']>;

/** off 永不；always 总是；unfocused（默认）仅窗口失焦时。 */
export function shouldNotify(mode: NotifyMode | undefined, focused: boolean): boolean {
  const effective = mode ?? 'unfocused';
  if (effective === 'off') return false;
  if (effective === 'always') return true;
  return !focused;
}
