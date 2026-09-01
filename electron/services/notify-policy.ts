// 通知档位判定（纯函数，与 electron 解耦，便于单测）。
import type { NotifyKind, SettingsSnapshot } from '@shared/host-api/contract';

export type NotifyMode = NonNullable<SettingsSnapshot['notifyMode']>;

/**
 * 计算通知判定用「用户是否正在查看该会话」：
 * 会话已落盘（有 sessionPath）时，窗口聚焦 且 该会话是窗口活动会话才算
 * 「正在查看」；窗口失焦、窗口已关、或同窗口切到其他会话（活动会话不是它）
 * 都视为没在看，完成通知不被吞。未指定会话（in-memory）回退旧口径
 * 「任一窗口聚焦」。
 */
export function resolveNotifyFocused(
  sessionPath: string | undefined,
  viewing: boolean | null,
  anyWindowFocused: boolean,
): boolean {
  if (!sessionPath) return anyWindowFocused;
  return viewing ?? false;
}

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
