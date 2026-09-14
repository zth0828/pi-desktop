import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, Loader2, X } from 'lucide-react';
import { hostApi } from '../../../lib/host-api';
import { onHostEvent } from '../../../lib/host-events';

export const PLAN_MODE_PACKAGE_SOURCE = 'npm:@narumitw/pi-plan-mode';

export interface PlanInstallDialogProps {
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
}

export function PlanInstallDialog({ open, onClose, onInstalled }: PlanInstallDialogProps) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<string>();

  useEffect(() => {
    if (!open) {
      setInstalling(false);
      setError(undefined);
      setProgress(undefined);
      return;
    }
    const unbind = onHostEvent('piPackages', 'progress', (event) => {
      if (typeof event === 'string') {
        setProgress(event);
      } else if (event && typeof (event as { message?: string }).message === 'string') {
        setProgress((event as { message: string }).message);
      }
    });
    return unbind;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !installing) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, installing, onClose]);

  if (!open) return null;

  const handleInstall = async () => {
    setInstalling(true);
    setError(undefined);
    try {
      const res = await hostApi.piPackages.install(PLAN_MODE_PACKAGE_SOURCE);
      if (res.success) {
        onInstalled();
        onClose();
      } else {
        setError(res.error || t('chat.planInstall.failed', { error: 'Unknown error' }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('chat.planInstall.failed', { error: msg }));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="plan-install-overlay" data-testid="plan-install-dialog" role="dialog" aria-modal="true">
      <div className="plan-install-dialog">
        <div className="plan-install-header">
          <div className="plan-install-icon-wrap">
            <Compass size={22} />
          </div>
          <div className="plan-install-title-group">
            <h3 className="plan-install-title">{t('chat.planInstall.title')}</h3>
            <p className="plan-install-desc">{t('chat.planInstall.desc')}</p>
          </div>
          {!installing && (
            <button
              type="button"
              className="icon-button"
              data-testid="plan-install-close"
              aria-label={t('extui.dismiss')}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="plan-install-note">
          <span>{t('chat.planInstall.note')}</span>
        </div>

        {progress && installing && (
          <p className="hint" data-testid="plan-install-progress">
            {progress}
          </p>
        )}

        {error && (
          <p className="plan-install-error" data-testid="plan-install-error">
            {error}
          </p>
        )}

        <div className="plan-install-actions">
          <button
            type="button"
            className="btn"
            data-testid="plan-install-cancel"
            disabled={installing}
            onClick={onClose}
          >
            {t('chat.planInstall.cancelBtn')}
          </button>
          <button
            type="button"
            className="btn primary"
            data-testid="plan-install-confirm"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing && <Loader2 size={14} className="spin" />}
            <span>{installing ? t('chat.planInstall.installing') : t('chat.planInstall.installBtn')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
