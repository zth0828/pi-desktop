import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Folder, FolderOpen, X } from 'lucide-react';
import { hostApi } from '../../lib/host-api';
import { usePaneChatStore } from './chat-store-context';

export function SessionCwdMissingDialog() {
  const { t } = useTranslation();
  const sessionCwdMissing = usePaneChatStore((s) => s.sessionCwdMissing);
  const switchSession = usePaneChatStore((s) => s.switchSession);
  const dismissSessionCwdMissing = usePaneChatStore((s) => s.dismissSessionCwdMissing);

  useEffect(() => {
    if (!sessionCwdMissing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissSessionCwdMissing();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionCwdMissing, dismissSessionCwdMissing]);

  if (!sessionCwdMissing) return null;

  const onConfirmFallback = () => {
    void switchSession(sessionCwdMissing.sessionPath, sessionCwdMissing.fallbackCwd, {
      cwdOverride: sessionCwdMissing.fallbackCwd,
    });
  };

  const onPickDirectory = async () => {
    const result = await hostApi.dialog.openDirectory(
      t('chat.sessionCwdMissing.chooseDirectoryTitle'),
      sessionCwdMissing.sessionCwd,
    );
    if (result.canceled || !result.filePaths?.[0]) return;
    const chosenCwd = result.filePaths[0];
    dismissSessionCwdMissing();
    await switchSession(sessionCwdMissing.sessionPath, chosenCwd, {
      cwdOverride: chosenCwd,
    });
  };

  return (
    <div
      className="confirm-undo-overlay"
      data-testid="session-cwd-missing-overlay"
      onClick={dismissSessionCwdMissing}
    >
      <div
        className="session-cwd-missing-dialog"
        data-testid="session-cwd-missing-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="session-cwd-missing-header">
          <div className="session-cwd-missing-header-title">
            <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
            <span>{t('chat.sessionCwdMissing.title')}</span>
          </div>
          <button
            type="button"
            className="confirm-undo-close"
            data-testid="session-cwd-missing-close"
            aria-label={t('common.close')}
            onClick={dismissSessionCwdMissing}
          >
            <X size={15} />
          </button>
        </div>

        <p className="session-cwd-missing-desc">
          {t('chat.sessionCwdMissing.description')}
        </p>

        <div className="session-cwd-paths-container">
          <div className="session-cwd-path-row">
            <span className="session-cwd-path-label">
              <span>{t('chat.sessionCwdMissing.originalCwd')}</span>
              <span className="session-cwd-badge missing">{t('chat.sessionCwdMissing.notFound')}</span>
            </span>
            <div
              className="session-cwd-path-box missing"
              data-testid="session-cwd-missing-message"
              title={sessionCwdMissing.sessionCwd}
            >
              <Folder size={14} />
              <span className="session-cwd-path-text">{sessionCwdMissing.sessionCwd}</span>
            </div>
          </div>

          <div className="session-cwd-path-row">
            <span className="session-cwd-path-label">
              <span>{t('chat.sessionCwdMissing.currentCwd')}</span>
              <span className="session-cwd-badge current">{t('chat.sessionCwdMissing.current')}</span>
            </span>
            <div className="session-cwd-path-box" title={sessionCwdMissing.fallbackCwd}>
              <Folder size={14} />
              <span className="session-cwd-path-text">{sessionCwdMissing.fallbackCwd}</span>
            </div>
          </div>
        </div>

        <div className="session-cwd-missing-footer">
          <button
            type="button"
            className="confirm-undo-btn confirm-undo-btn-cancel"
            data-testid="session-cwd-missing-cancel"
            onClick={dismissSessionCwdMissing}
          >
            {t('chat.sessionCwdMissing.cancel')}
          </button>

          <div className="session-cwd-missing-footer-actions">
            <button
              type="button"
              className="confirm-undo-btn confirm-undo-btn-cancel"
              data-testid="session-cwd-missing-confirm"
              onClick={onConfirmFallback}
            >
              {t('chat.sessionCwdMissing.continueInCurrent')}
            </button>
            <button
              type="button"
              className="confirm-undo-btn confirm-undo-btn-confirm"
              data-testid="session-cwd-missing-choose"
              onClick={() => void onPickDirectory()}
            >
              <FolderOpen size={14} />
              <span>{t('chat.sessionCwdMissing.chooseNew')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
