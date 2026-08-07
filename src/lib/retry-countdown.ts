// retry 倒计时纯逻辑：按 auto_retry_start 的 delayMs 本地倒数（对齐 pi TUI
// status-indicator 的 `Retrying (n/m) in Xs...`）。

export type RetryCountdown = { startedAt: number; delayMs?: number };

/**
 * 距重试发起的剩余秒数（向上取整，不为负）。
 * 无 delayMs（如扩展错误合成的 retry）返回 null，调用方不显示倒计时。
 */
export function retryRemainingSeconds(retry: RetryCountdown, now: number): number | null {
  if (retry.delayMs == null) return null;
  return Math.max(0, Math.ceil((retry.startedAt + retry.delayMs - now) / 1000));
}
