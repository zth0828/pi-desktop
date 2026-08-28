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
    let disposed = false;
    // 挂载时拉取待展示通知：启动检查完成时渲染层可能尚未订阅，推送会丢，拉取兜底
    void hostApi.versionCheck.getPendingNotice().then((notice) => {
      if (!disposed && notice) setInfo((current) => current ?? notice);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    return onHostEvent('versionCheck', 'updateAvailable', (eventPayload) => {
      setInfo((current) =>
        current && current.kind === eventPayload.kind && current.latest === eventPayload.latest ? current : eventPayload);
      setDismissed(false);
    });
  }, []);

  // 关闭/点击行动都视为已读：标记后重启不再弹同版本
  const dismiss = () => {
    setDismissed(true);
    if (info) void hostApi.versionCheck.dismissNotice({ kind: info.kind, latest: info.latest });
  };

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
          onClick={dismiss}
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
            dismiss();
            setTimeout(() => {
              const targetId = info.kind === 'app' ? 'settings-app-version-status' : 'settings-pi-status';
              const el = document.getElementById(targetId) ?? document.getElementById('settings-about');
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
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
