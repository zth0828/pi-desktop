import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { retryRemainingSeconds } from '../../lib/retry-countdown';
import { useChatStore } from '../../stores/chat';

function QueueChip({ kind, items }: { kind: 'steering' | 'followUp'; items: string[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const first = items[0].replace(/\s+/g, ' ').trim();
  const preview = first.length > 40 ? `${first.slice(0, 40)}…` : first;
  return (
    <span className="queue-chip" data-testid={`queue-chip-${kind}`} title={items.join('\n')}>
      {t(`chat.queue.${kind}`, { count: items.length, preview })}
    </span>
  );
}

/**
 * 执行中状态条（对齐 pi TUI status-indicator）：
 * compaction > retry > working；另显示 steer/followUp 排队 chip。
 * 中断入口在 ChatInput 的 ■，这里只负责展示。
 */
export function StatusBar() {
  const { t } = useTranslation();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const retry = useChatStore((s) => s.retry);
  const compaction = useChatStore((s) => s.compaction);
  const queue = useChatStore((s) => s.queue);
  const [, setTick] = useState(0);

  // retry 倒计时：按 delayMs 本地倒数（pi 不会在倒计时期间再发事件）
  useEffect(() => {
    if (!retry || retry.delayMs == null) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [retry]);

  let status: { testid: string; text: string; title?: string } | null = null;
  if (compaction) {
    status = {
      testid: 'status-compaction',
      text:
        compaction.reason === 'overflow'
          ? t('chat.status.compactingOverflow')
          : t('chat.status.compacting'),
    };
  } else if (retry) {
    const seconds = retryRemainingSeconds(retry, Date.now());
    const hasCount = retry.attempt != null && retry.maxAttempts != null;
    status = {
      testid: 'status-retry',
      text: !hasCount
        ? t('chat.status.retryingGeneric')
        : seconds != null
          ? t('chat.status.retrying', {
              attempt: retry.attempt,
              maxAttempts: retry.maxAttempts,
              seconds,
            })
          : t('chat.status.retryingNow', {
              attempt: retry.attempt,
              maxAttempts: retry.maxAttempts,
            }),
      title: retry.errorMessage,
    };
  } else if (isStreaming) {
    status = { testid: 'status-working', text: t('chat.status.working') };
  }

  const hasQueue = queue.steering.length > 0 || queue.followUp.length > 0;
  if (!status && !hasQueue) return null;

  return (
    <div className="status-bar" data-testid="status-bar">
      {status && (
        <span className="status-bar-indicator" data-testid={status.testid} title={status.title}>
          <span className="status-bar-spinner" aria-hidden="true" />
          {status.text}
        </span>
      )}
      <span className="spacer" />
      <QueueChip kind="steering" items={queue.steering} />
      <QueueChip kind="followUp" items={queue.followUp} />
    </div>
  );
}
