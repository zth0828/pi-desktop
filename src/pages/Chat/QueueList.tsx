import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Image as ImageIcon, Route, Send, Zap } from 'lucide-react';
import { extractQueueAttachments } from '@shared/message-attachments';
import { FileIcon, getFileBadgeText } from '../../components/FileIcon';
import { composerAttachmentsCache } from './chat-input/composer-attachments-cache';
import { usePaneChatStore } from './chat-store-context';
import { ImageLightbox } from './ImageLightbox';

const KINDS = ['steering', 'followUp'] as const;

/**
 * 排队消息列表（pi steer/followUp 队列的壳暴露，queue_update 透传驱动）。
 * 每条可取回编辑；followUp 项可改为 steer，进入当前工作轮。
 */
export function QueueList() {
  const { t } = useTranslation();
  const queue = usePaneChatStore((s) => s.queue);
  const cwd = usePaneChatStore((s) => s.cwd);
  const queueRemove = usePaneChatStore((s) => s.queueRemove);
  const queueMove = usePaneChatStore((s) => s.queueMove);
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

  if (queue.steering.length === 0 && queue.followUp.length === 0) return null;

  const total = queue.steering.length + queue.followUp.length;
  return (
    <section className="queue-list" data-testid="queue-list" aria-label={t('chat.queue.title')}>
      <header className="queue-list-header">
        <span><Route size={14} />{t('chat.queue.title')}</span>
        <strong>{total}</strong>
      </header>
      {KINDS.flatMap((kind) =>
        queue[kind].map((text, index) => {
          const { attachments, displayText } = extractQueueAttachments(text, cwd);
          const hasAttachments = attachments.length > 0;
          return (
            <div className={`queue-item queue-${kind}`} data-testid={`queue-item-${kind}`} key={`${kind}-${index}`}>
              <span className="queue-item-icon" aria-hidden="true">
                {kind === 'steering' ? <Zap size={14} /> : <Send size={14} />}
              </span>
              <div className="queue-item-content">
                <span className="queue-item-kind">{t(`chat.queue.${kind}Label`)}</span>
                {hasAttachments && (
                  <div className="queue-item-attachments" data-testid="queue-item-attachments">
                    {attachments.map((att) => {
                      if (att.kind === 'image') {
                        const previewUrl =
                          composerAttachmentsCache.getPreviewUrl(att.fullName) ||
                          composerAttachmentsCache.getPreviewUrl(att.name);
                        return (
                          <span
                            key={att.key}
                            className="queue-attachment-image"
                            data-testid="queue-attachment-image"
                            data-attachment-index={att.index}
                          >
                            {previewUrl ? (
                              <button
                                type="button"
                                className="queue-image-preview"
                                data-testid="queue-image-preview"
                                title={att.fullName}
                                aria-label={t('chat.imageAttachment', { index: att.index, name: att.name })}
                                onClick={() => setPreviewImage({ url: previewUrl, name: att.name })}
                              >
                                <img src={previewUrl} alt={att.name} />
                                <span className="attachment-order">{att.index}</span>
                              </button>
                            ) : (
                              <span
                                className="queue-attachment-file queue-attachment-fallback-image"
                                title={att.fullName}
                              >
                                <span className="attachment-order">{att.index}</span>
                                <span className="queue-file-icon">
                                  <ImageIcon size={15} />
                                </span>
                                <span className="queue-file-name" title={att.fullName}>{att.name}</span>
                                <span className="file-ext-badge">{getFileBadgeText(att.name)}</span>
                              </span>
                            )}
                          </span>
                        );
                      }

                      return (
                        <span
                          key={att.key}
                          className="queue-attachment-file"
                          data-testid="queue-attachment-file"
                          data-attachment-index={att.index}
                          title={att.fullName}
                        >
                          <span className="attachment-order">{att.index}</span>
                          <span className="queue-file-icon">
                            <FileIcon name={att.name} size={15} />
                          </span>
                          <span className="queue-file-name" title={att.fullName}>{att.name}</span>
                          <span className="file-ext-badge">{getFileBadgeText(att.name)}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {displayText && (
                  <span className="queue-item-text" title={displayText}>{displayText}</span>
                )}
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
          );
        }),
      )}
      {previewImage && (
        <ImageLightbox
          src={previewImage.url}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </section>
  );
}

