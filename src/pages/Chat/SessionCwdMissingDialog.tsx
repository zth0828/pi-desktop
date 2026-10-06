import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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

  const onConfirm = () => {
    void switchSession(sessionCwdMissing.sessionPath, sessionCwdMissing.fallbackCwd, {
      cwdOverride: sessionCwdMissing.fallbackCwd,
    });
  };

  return (
    <div className="extui-overlay" data-testid="session-cwd-missing-overlay">
      <div className="extui-dialog" data-testid="session-cwd-missing-dialog" role="dialog" aria-modal="true">
        <div className="extui-title">{t('chat.sessionCwdMissing.title')}</div>
        <div className="extui-message" data-testid="session-cwd-missing-message">
          {t('chat.sessionCwdMissing.message', {
            sessionCwd: sessionCwdMissing.sessionCwd,
            fallbackCwd: sessionCwdMissing.fallbackCwd,
          })}
        </div>
        <div className="extui-footer">
          <button
            type="button"
            className="btn"
            data-testid="session-cwd-missing-cancel"
            onClick={dismissSessionCwdMissing}
          >
            {t('chat.sessionCwdMissing.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            data-testid="session-cwd-missing-confirm"
            onClick={onConfirm}
          >
            {t('chat.sessionCwdMissing.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
