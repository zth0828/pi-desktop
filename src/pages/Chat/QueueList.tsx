import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Route, Send, Zap } from 'lucide-react';
import { usePaneChatStore } from './chat-store-context';

const KINDS = ['steering', 'followUp'] as const;

/**
 * 排队消息列表（pi steer/followUp 队列的壳暴露，queue_update 透传驱动）。
 * 每条可取回编辑；followUp 项可改为 steer，进入当前工作轮。
 */
export function QueueList() {
  const { t } = useTranslation();
  const queue = usePaneChatStore((s) => s.queue);
  const queueRemove = usePaneChatStore((s) => s.queueRemove);
  const queueMove = usePaneChatStore((s) => s.queueMove);

  if (queue.steering.length === 0 && queue.followUp.length === 0) return null;

  const total = queue.steering.length + queue.followUp.length;
  return (
    <section className="queue-list" data-testid="queue-list" aria-label={t('chat.queue.title')}>
      <header className="queue-list-header">
        <span><Route size={14} />{t('chat.queue.title')}</span>
        <strong>{total}</strong>
      </header>
      {KINDS.flatMap((kind) =>
        queue[kind].map((text, index) => (
          <div className={`queue-item queue-${kind}`} data-testid={`queue-item-${kind}`} key={`${kind}-${index}`}>
            <span className="queue-item-icon" aria-hidden="true">
              {kind === 'steering' ? <Zap size={14} /> : <Send size={14} />}
            </span>
            <div className="queue-item-content">
              <span className="queue-item-kind">{t(`chat.queue.${kind}Label`)}</span>
              <span className="queue-item-text" title={text}>{text.replace(/\s+/g, ' ').trim()}</span>
            </div>
            <div className="queue-item-actions">
              <button
                className="queue-item-action queue-item-mode"
                data-testid={`queue-mode-${kind}-${index}`}
                title={t(`chat.queue.${kind === 'followUp' ? 'sendNowTip' : 'sendTip'}`)}
                onClick={() => void queueMove(kind, index, kind === 'steering' ? 'followUp' : 'steering')}
              >
                {kind === 'followUp' ? <Send size={13} /> : <Zap size={13} />}
                {t(`chat.queue.${kind === 'followUp' ? 'sendNow' : 'send'}`)}
              </button>
              <button
                className="queue-item-action queue-item-edit"
                data-testid={`queue-remove-${kind}-${index}`}
                title={t('chat.queue.editTip')}
                onClick={() => void queueRemove(kind, index)}
              >
                <CornerDownLeft size={13} />
                {t('chat.queue.edit')}
              </button>
            </div>
          </div>
        )),
      )}
    </section>
  );
}
