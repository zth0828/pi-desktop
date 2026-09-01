import { useTranslation } from 'react-i18next';
import { FileIcon, getFileBadgeText } from '../../../components/FileIcon';
import type { StagedAttachment } from './types';

export interface ChatInputAttachmentsProps {
  attachments: StagedAttachment[];
  onRemove: (index: number) => void;
  onPreviewImage: (image: { url: string; name?: string }) => void;
}

export function ChatInputAttachments({
  attachments,
  onRemove,
  onPreviewImage,
}: ChatInputAttachmentsProps) {
  const { t } = useTranslation();

  if (attachments.length === 0) return null;

  return (
    <div className="staged-attachments" data-testid="staged-attachments">
      {attachments.map((attachment, index) =>
        attachment.kind === 'image' ? (
          <span
            key={`${attachment.name}-${index}`}
            className="staged-image"
            data-testid="staged-image"
            data-attachment-index={index + 1}
          >
            <button
              type="button"
              className="staged-image-preview"
              data-testid="staged-image-preview"
              aria-label={t('chat.imageAttachment', { index: index + 1, name: attachment.name })}
              onClick={() => onPreviewImage({ url: attachment.previewUrl, name: attachment.name })}
            >
              <img src={attachment.previewUrl} alt={attachment.name} />
              <span className="attachment-order">{index + 1}</span>
            </button>
            <button
              type="button"
              className="staged-remove"
              aria-label={t('chat.removeAttachment')}
              onClick={() => onRemove(index)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ) : (
          <span
            key={`${attachment.name}-${index}`}
            className="staged-file"
            data-testid="staged-file"
            data-attachment-index={index + 1}
          >
            <span className="attachment-order">{index + 1}</span>
            <span className="staged-file-icon">
              <FileIcon name={attachment.name} size={15} />
            </span>
            <span className="staged-file-name" title={attachment.name}>{attachment.name}</span>
            <span className="file-ext-badge">{getFileBadgeText(attachment.name)}</span>
            <button
              type="button"
              className="staged-remove"
              aria-label={t('chat.removeAttachment')}
              onClick={() => onRemove(index)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ),
      )}
    </div>
  );
}
