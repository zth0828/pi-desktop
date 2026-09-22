import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import { hostApi } from '../lib/host-api';
import { Markdown } from './Markdown';
import { sanitizeReleaseNotes } from '@shared/release-notes';
import type { VersionJumpInfo } from '@shared/host-api/contract';

export function VersionJumpDialog() {
  const { t } = useTranslation();
  const [jumpInfo, setJumpInfo] = useState<VersionJumpInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hostApi.versionCheck.checkVersionJump().then((res) => {
      if (cancelled) return;
      if (res.hasJump && res.currentVersion) {
        setJumpInfo(res);
        setOpen(true);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = async () => {
    setOpen(false);
    await hostApi.versionCheck.dismissVersionJump().catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void handleDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open || !jumpInfo) return null;

  const sanitizedNotes = sanitizeReleaseNotes(jumpInfo.releaseNotes);

  return (
    <div className="version-install-overlay" data-testid="version-jump-overlay">
      <div
        className="version-install-dialog version-jump-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('versionJump.title', { version: jumpInfo.currentVersion })}
        data-testid="version-jump-dialog"
      >
        <div className="version-install-header">
          <div className="version-install-header-title">
            <Sparkles size={16} className="text-accent" />
            <span>{t('versionJump.title', { version: jumpInfo.currentVersion })}</span>
          </div>
          <button
            className="icon-button"
            data-testid="version-jump-close"
            aria-label={t('extui.dismiss')}
            onClick={() => void handleDismiss()}
          >
            <X size={14} />
          </button>
        </div>

        <div className="version-install-body version-jump-body">
          <div className="version-jump-subtitle">
            {t('versionJump.subtitle', {
              from: jumpInfo.previousVersion || 'previous',
              to: jumpInfo.currentVersion,
            })}
          </div>

          {sanitizedNotes ? (
            <div className="version-jump-notes-scroll" data-testid="version-jump-notes">
              <Markdown text={sanitizedNotes} />
            </div>
          ) : (
            <p className="settings-section-hint">{t('versionJump.noNotes')}</p>
          )}
        </div>

        <div className="version-install-footer">
          <div className="version-install-footer-right" style={{ marginLeft: 'auto' }}>
            <button
              className="pill active"
              data-testid="version-jump-confirm"
              onClick={() => void handleDismiss()}
            >
              {t('versionJump.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
