import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Folder, FolderOpen, FolderSync, X } from 'lucide-react';
import { hostApi } from '../../lib/host-api';
import { usePaneChatStore } from './chat-store-context';

export function SessionCwdMissingDialog() {
  const { t } = useTranslation();
  const sessionCwdMissing = usePaneChatStore((s) => s.sessionCwdMissing);
  const switchSession = usePaneChatStore((s) => s.switchSession);
  const dismissSessionCwdMissing = usePaneChatStore((s) => s.dismissSessionCwdMissing);
  const [applyToAll, setApplyToAll] = useState(true);

  useEffect(() => {
    if (!sessionCwdMissing) return;
    setApplyToAll(true);
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

  const count = sessionCwdMissing.sessionCount ?? 1;
  const detectedCwd = sessionCwdMissing.detectedCwd;
  const originalCwd = sessionCwdMissing.sessionCwd;
  const fallbackCwd = sessionCwdMissing.fallbackCwd;

  const originalName = originalCwd.split(/[\\/]/).filter(Boolean).pop() || '';
  const fallbackName = fallbackCwd.split(/[\\/]/).filter(Boolean).pop() || '';
  const isMismatch = Boolean(originalName && fallbackName && originalName !== fallbackName);

  const handleApplyCwd = async (targetCwd: string) => {
    let targetSessionPath = sessionCwdMissing.sessionPath;
    if (applyToAll && count > 1) {
      const relocateRes = await hostApi.piSessions.relocateProject(
        sessionCwdMissing.sessionCwd,
        targetCwd,
      );
      if (relocateRes.success && relocateRes.movedPaths?.[sessionCwdMissing.sessionPath]) {
        targetSessionPath = relocateRes.movedPaths[sessionCwdMissing.sessionPath];
      }
    }
    dismissSessionCwdMissing();
    await switchSession(targetSessionPath, targetCwd, {
      cwdOverride: targetCwd,
    });
  };

  const onConfirmFallback = () => {
    void handleApplyCwd(fallbackCwd);
  };

  const onPickDirectory = async () => {
    const result = await hostApi.dialog.openDirectory(
      t('chat.sessionCwdMissing.chooseDirectoryTitle'),
      detectedCwd || sessionCwdMissing.sessionCwd,
    );
    if (result.canceled || !result.filePaths?.[0]) return;
    void handleApplyCwd(result.filePaths[0]);
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
          {detectedCwd
            ? t('chat.sessionCwdMissing.descriptionDetected')
            : t('chat.sessionCwdMissing.description')}
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
              title={originalCwd}
            >
              <Folder size={14} />
              <span className="session-cwd-path-text">{originalCwd}</span>
            </div>
          </div>

          {detectedCwd ? (
            <div className="session-cwd-path-row">
              <span className="session-cwd-path-label">
                <span>{t('chat.sessionCwdMissing.detectedCwd')}</span>
                <span className="session-cwd-badge detected">{t('chat.sessionCwdMissing.detected')}</span>
              </span>
              <div
                className="session-cwd-path-box detected"
                data-testid="session-cwd-missing-detected-box"
                title={detectedCwd}
              >
                <FolderSync size={14} style={{ color: 'var(--success, #10b981)' }} />
                <span className="session-cwd-path-text">{detectedCwd}</span>
              </div>
            </div>
          ) : (
            <div className="session-cwd-path-row">
              <span className="session-cwd-path-label">
                <span>{t('chat.sessionCwdMissing.currentCwd')}</span>
                <span className="session-cwd-badge current">{t('chat.sessionCwdMissing.current')}</span>
              </span>
              <div className="session-cwd-path-box" title={fallbackCwd}>
                <Folder size={14} />
                <span className="session-cwd-path-text">{fallbackCwd}</span>
              </div>
            </div>
          )}
        </div>

        {!detectedCwd && isMismatch && (
          <div className="session-cwd-mismatch-warning" data-testid="session-cwd-mismatch-warning">
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {t('chat.sessionCwdMissing.mismatchWarning', { original: originalName, current: fallbackName })}
            </span>
          </div>
        )}

        {count > 1 && (
          <label className="session-cwd-batch-toggle" data-testid="session-cwd-missing-batch-toggle">
            <input
              type="checkbox"
              data-testid="session-cwd-missing-batch-checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            <span>{t('chat.sessionCwdMissing.applyToAll', { count })}</span>
          </label>
        )}

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
            {detectedCwd ? (
              <>
                <button
                  type="button"
                  className="confirm-undo-btn confirm-undo-btn-cancel"
                  data-testid="session-cwd-missing-choose"
                  onClick={() => void onPickDirectory()}
                >
                  <FolderOpen size={14} />
                  <span>{t('chat.sessionCwdMissing.chooseOther')}</span>
                </button>
                <button
                  type="button"
                  className="confirm-undo-btn confirm-undo-btn-confirm"
                  data-testid="session-cwd-missing-apply-detected"
                  onClick={() => void handleApplyCwd(detectedCwd)}
                >
                  <FolderSync size={14} />
                  <span>{t('chat.sessionCwdMissing.migrateToDetected')}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="confirm-undo-btn confirm-undo-btn-cancel"
                  data-testid="session-cwd-missing-confirm"
                  onClick={onConfirmFallback}
                  title={isMismatch ? t('chat.sessionCwdMissing.mismatchWarning', { original: originalName, current: fallbackName }) : undefined}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
