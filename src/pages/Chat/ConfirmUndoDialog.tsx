import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, X } from 'lucide-react';
import { FileIcon } from '../../components/FileIcon';

export interface ConfirmUndoFile {
  path: string;
  action: 'delete' | 'revert' | 'restore';
}

export interface ConfirmUndoDialogProps {
  open: boolean;
  files: ConfirmUndoFile[];
  onConfirm: (options: { revertFiles: boolean; rewindConversation: boolean }) => void | Promise<void>;
  onClose: () => void;
  isReverting?: boolean;
}

export function ConfirmUndoDialog({
  open,
  files,
  onConfirm,
  onClose,
  isReverting = false,
}: ConfirmUndoDialogProps) {
  const { t } = useTranslation();
  const [revertFiles, setRevertFiles] = useState(true);
  const [rewindConversation, setRewindConversation] = useState(true);

  useEffect(() => {
    if (open) {
      setRevertFiles(true);
      setRewindConversation(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        // 允许按 Enter 快速确认（如果在按钮外按回车）
        e.preventDefault();
        if (!isReverting) {
          void onConfirm({ revertFiles, rewindConversation });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, revertFiles, rewindConversation, isReverting, onConfirm, onClose]);

  if (!open) return null;

  return (
    <div
      className="confirm-undo-overlay"
      data-testid="confirm-undo-overlay"
      onClick={onClose}
    >
      <div
        className="confirm-undo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-undo-title"
        data-testid="confirm-undo-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-undo-header">
          <h3
            id="confirm-undo-title"
            className="confirm-undo-title"
            data-testid="confirm-undo-title"
          >
            {t('chat.confirmUndo.title')}
          </h3>
          <button
            type="button"
            className="confirm-undo-close"
            data-testid="confirm-undo-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <div className="confirm-undo-body">
          <p className="confirm-undo-desc" data-testid="confirm-undo-desc">
            {t('chat.confirmUndo.description')}
          </p>

          <label className="confirm-undo-checkbox-label">
            <input
              type="checkbox"
              className="confirm-undo-checkbox"
              data-testid="confirm-undo-revert-checkbox"
              checked={revertFiles}
              onChange={(e) => setRevertFiles(e.target.checked)}
            />
            <span>{t('chat.confirmUndo.revertModifiedFiles')}</span>
          </label>
          <div className="confirm-undo-hint">{t('chat.confirmUndo.revertFilesHint')}</div>

          <div
            className={`confirm-undo-files ${!revertFiles ? 'is-disabled' : ''}`}
            data-testid="confirm-undo-files"
          >
            {files.map((file) => {
              const actionLabel =
                file.action === 'delete'
                  ? t('chat.confirmUndo.actionDelete')
                  : file.action === 'restore'
                    ? t('chat.confirmUndo.actionRestore')
                    : t('chat.confirmUndo.actionRevert');
              return (
                <div
                  key={file.path}
                  className="confirm-undo-file-item"
                  data-testid="confirm-undo-file-item"
                >
                  <div className="confirm-undo-file-main">
                    <FileIcon name={file.path} size={14} />
                    <span
                      className="confirm-undo-file-path"
                      data-testid="confirm-undo-file-path"
                      title={file.path}
                    >
                      {file.path}
                    </span>
                  </div>
                  <span
                    className={`confirm-undo-file-action action-${file.action}`}
                    data-testid="confirm-undo-file-action"
                  >
                    {actionLabel}
                  </span>
                </div>
              );
            })}
          </div>

          <label className="confirm-undo-checkbox-label" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              className="confirm-undo-checkbox"
              data-testid="confirm-undo-rewind-checkbox"
              checked={rewindConversation}
              onChange={(e) => setRewindConversation(e.target.checked)}
            />
            <span>{t('chat.confirmUndo.rewindConversation')}</span>
          </label>
          <div className="confirm-undo-hint">{t('chat.confirmUndo.rewindConversationHint')}</div>

          <div className="confirm-undo-git-protection" data-testid="confirm-undo-git-protection">
            <span>{t('chat.confirmUndo.gitProtectionNotice')}</span>
          </div>
        </div>

        <div className="confirm-undo-footer">
          <button
            type="button"
            className="confirm-undo-btn confirm-undo-btn-cancel"
            data-testid="confirm-undo-cancel"
            disabled={isReverting}
            onClick={onClose}
          >
            {t('chat.confirmUndo.cancel')}
          </button>
          <button
            type="button"
            className="confirm-undo-btn confirm-undo-btn-secondary"
            data-testid="confirm-undo-files-only"
            disabled={isReverting}
            onClick={() => void onConfirm({ revertFiles: true, rewindConversation: false })}
          >
            {t('chat.confirmUndo.onlyFiles')}
          </button>
          <button
            type="button"
            className="confirm-undo-btn confirm-undo-btn-secondary"
            data-testid="confirm-undo-conversation-only"
            disabled={isReverting}
            onClick={() => void onConfirm({ revertFiles: false, rewindConversation: true })}
          >
            {t('chat.confirmUndo.onlyConversation')}
          </button>
          <button
            type="button"
            className="confirm-undo-btn confirm-undo-btn-confirm confirm-undo-btn-full"
            data-testid="confirm-undo-full"
            disabled={isReverting}
            onClick={() => void onConfirm({ revertFiles: true, rewindConversation: true })}
          >
            <span>{t('chat.confirmUndo.fullUndo')}</span>
            <CornerDownLeft size={13} className="confirm-undo-return-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}
