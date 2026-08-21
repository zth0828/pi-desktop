import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import { onHostEvent } from '../lib/host-events';
import { hostApi } from '../lib/host-api';
import type { AppPageId } from '@shared/app-page';

type VersionUpdateInfo = {
  current: string;
  latest: string;
  releaseUrl?: string;
  kind: 'app' | 'pi';
};

export function VersionUpdateToast({ onNavigate }: { onNavigate: (page: AppPageId) => void }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<VersionUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return onHostEvent('versionCheck', 'updateAvailable', (eventPayload) => {
      setInfo(eventPayload);
      setDismissed(false);
    });
  }, []);

  if (!info || dismissed) return null;

  const versionTag = info.latest.replace(/^v/, '');

  return (
    <aside
      className="version-update-toast"
      data-testid="version-update-toast"
      role="status"
      aria-live="polite"
      aria-label={t('versionUpdate.title')}
    >
      <div className="version-update-toast-head">
        <div className="version-update-toast-title">
          <Sparkles size={14} />
          <span>{t('versionUpdate.title')}</span>
        </div>
        <button
          className="icon-button"
          data-testid="version-update-dismiss"
          title={t('versionUpdate.dismiss')}
          aria-label={t('versionUpdate.dismiss')}
          onClick={() => setDismissed(true)}
        >
          <X size={14} />
        </button>
      </div>

      <div className="version-update-toast-body" data-testid="version-update-body">
        {info.kind === 'app'
          ? t('versionUpdate.body', { version: versionTag })
          : t('versionUpdate.bodyPi', { version: versionTag })}
      </div>

      <div className="version-update-toast-actions">
        <button
          className="pill active"
          data-testid="version-update-action"
          onClick={() => {
            onNavigate('settings');
            setDismissed(true);
          }}
        >
          {t(info.kind === 'app' ? 'versionUpdate.download' : 'versionUpdate.upgradePi')}
        </button>
        {info.releaseUrl && (
          <button
            className="pill"
            data-testid="version-update-release-notes"
            onClick={() => void hostApi.shell.openExternal(info.releaseUrl!)}
          >
            {t('versionUpdate.releaseNotes')}
          </button>
        )}
      </div>
    </aside>
  );
}
