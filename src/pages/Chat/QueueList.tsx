import { useTranslation } from 'react-i18next';
import { X, Zap } from 'lucide-react';
import { useChatStore } from '../../stores/chat';

const KINDS = ['steering', 'followUp'] as const;

/**
 * 排队消息列表（pi steer/followUp 队列的壳暴露，queue_update 透传驱动）。
 * 每条：摘要 + 删除；followUp 项另有「立即发送」（steer = 不打断当前轮直接插入）。
 * pi SDK 不支持编辑/重排（只有 clearQueue 全清），故不提供这两个入口。
 */
export function QueueList() {
  const { t } = useTranslation();
  const queue = useChatStore((s) => s.queue);
  const queueRemove = useChatStore((s) => s.queueRemove);
  const queueSteerNow = useChatStore((s) => s.queueSteerNow);

  if (queue.steering.length === 0 && queue.followUp.length === 0) return null;

  return (
    <div className="queue-list" data-testid="queue-list">
      {KINDS.flatMap((kind) =>
        queue[kind].map((text, index) => (
          <div className="queue-item" data-testid={`queue-item-${kind}`} key={`${kind}-${index}`}>
            <span className="queue-item-kind">{t(`chat.queue.${kind}Label`)}</span>
            <span className="queue-item-text" title={text}>
              {text.replace(/\s+/g, ' ').trim()}
            </span>
            {kind === 'followUp' && (
              <button
                className="queue-item-action queue-item-steer"
                data-testid={`queue-steer-now-${index}`}
                title={t('chat.queue.sendNowTip')}
                onClick={() => void queueSteerNow(kind, index)}
              >
                <Zap size={12} />
                {t('chat.queue.sendNow')}
              </button>
            )}
            <button
              className="queue-item-action"
              data-testid={`queue-remove-${kind}-${index}`}
              title={t('chat.queue.removeTip')}
              onClick={() => void queueRemove(kind, index)}
            >
              <X size={12} />
            </button>
          </div>
        )),
      )}
    </div>
  );
}
