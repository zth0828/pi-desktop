import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, FolderOpen, RefreshCw, X } from 'lucide-react';
import { onHostEvent } from '../lib/host-events';
import { hostApi } from '../lib/host-api';
import { Markdown } from './Markdown';

export function VersionInstallDialog() {
  const { t } = useTranslation();
  const [completedPath, setCompletedPath] = useState<string | null>(null);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  const [showRunningWarning, setShowRunningWarning] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [targetVersion, setTargetVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>(() => window.pidesktop?.platform ?? '');

  useEffect(() => {
    void hostApi.app.platform().then(setPlatform);
    return onHostEvent('appUpdate', 'progress', (event) => {
      if (event.phase === 'completed' || event.phase === 'ready') {
        if (event.silent) {
          return;
        }
        setCompletedPath(event.path ?? '');
        if (event.version) setTargetVersion(event.version);
        if (event.releaseNotes) setReleaseNotes(event.releaseNotes);
        setFailedError(null);
        setRetryStatus(null);
        setShowRunningWarning(false);
      } else if (event.phase === 'retrying') {
        setRetryStatus(
          t('versionInstall.retrying', {
            attempt: event.retryAttempt ?? 1,
            max: event.maxRetries ?? 3,
          }),
        );
      } else if (event.phase === 'failed') {
        setFailedError(event.error ?? t('settings.version.checkFailed'));
        setCompletedPath(null);
        setRetryStatus(null);
        setShowRunningWarning(false);
      }
    });
  }, [t]);

  const handleInstall = async (force = false) => {
    setInstalling(true);
    try {
      const res = await hostApi.appUpdate.installDownloaded(force);
      if (!res.success) {
        if (res.error === 'RUNNING_SESSIONS') {
          setShowRunningWarning(true);
        } else {
          setFailedError(res.error ?? t('settings.version.checkFailed'));
        }
        return;
      }
      setCompletedPath(null);
      setShowRunningWarning(false);
    } finally {
      setInstalling(false);
    }
  };

  const handleShowInFolder = () => {
    void hostApi.appUpdate.showDownloaded();
    setCompletedPath(null);
  };

  const handleDismiss = () => {
    setCompletedPath(null);
    setFailedError(null);
    setRetryStatus(null);
    setShowRunningWarning(false);
  };

  const handleSkip = async () => {
    if (targetVersion) {
      await hostApi.versionCheck.skipVersion(targetVersion).catch(() => {});
    }
    handleDismiss();
  };

  useEffect(() => {
    if (completedPath && !releaseNotes) {
      void hostApi.versionCheck.getStatus().then((status) => {
        if (status.app.releaseNotes) {
          setReleaseNotes(status.app.releaseNotes);
        }
      }).catch(() => {});
    }
  }, [completedPath, releaseNotes]);

  useEffect(() => {
    if (!failedError && !completedPath) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [failedError, completedPath]);

  if (failedError) {
    return (
      <div className="version-install-overlay" data-testid="version-download-failed-overlay">
        <div
          className="version-install-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label={t('versionInstall.title')}
          data-testid="version-download-failed-dialog"
        >
          <div className="version-install-header">
            <div className="version-install-header-title">
              <AlertTriangle size={16} className="text-danger" />
              <span>{t('settings.version.checkFailed')}</span>
            </div>
            <button
              className="icon-button"
              data-testid="version-failed-close"
              aria-label={t('extui.dismiss')}
              onClick={handleDismiss}
            >
              <X size={14} />
            </button>
          </div>
          <div className="version-install-body">
            <p className="error-text">{t('versionInstall.failed', { error: failedError })}</p>
            <p className="settings-section-hint">{t('settings.version.downloadFailedHint')}</p>
          </div>
          <div className="version-install-footer">
            <button
              className="pill active"
              data-testid="version-failed-dismiss"
              onClick={handleDismiss}
            >
              {t('extui.ok')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!completedPath) {
    if (retryStatus) {
      return (
        <div className="version-install-toast" data-testid="version-retry-toast">
          <RefreshCw size={14} className="spin" />
          <span>{retryStatus}</span>
        </div>
      );
    }
    return null;
  }

  const fileName = completedPath.split(/[/\\]/).pop() ?? '';
  const isLinux = platform === 'linux';
  const isMac = platform === 'darwin';

  const bodyText = isMac
    ? t('versionInstall.bodyMac')
    : isLinux
      ? t('versionInstall.bodyLinux')
      : t('versionInstall.bodyWin');

  return (
    <div className="version-install-overlay" data-testid="version-install-overlay">
      <div
        className="version-install-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('versionInstall.title')}
        data-testid="version-install-dialog"
      >
        <div className="version-install-header">
          <div className="version-install-header-title">
            <CheckCircle size={16} className="text-success" />
            <span>{t('versionInstall.title')}</span>
          </div>
          <button
            className="icon-button"
            data-testid="version-install-close"
            aria-label={t('versionInstall.later')}
            onClick={handleDismiss}
          >
            <X size={14} />
          </button>
        </div>

        <div className="version-install-body">
          {showRunningWarning ? (
            <div className="version-install-warning" data-testid="version-install-running-warning">
              <AlertTriangle size={16} className="text-warning" />
              <span>{t('versionInstall.runningWarning')}</span>
            </div>
          ) : (
            <>
              <p>{bodyText}</p>
              {fileName && (
                <div className="version-install-file-info">
                  <span className="version-install-filename">{fileName}</span>
                </div>
              )}
              {releaseNotes?.trim() && (
                <div className="version-install-changelog" data-testid="version-install-changelog">
                  <div className="version-install-changelog-title">
                    {t('settings.version.releaseNotesTitle', { version: targetVersion ?? '' })}
                  </div>
                  <div className="version-install-notes-scroll">
                    <Markdown text={releaseNotes.trim()} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="version-install-footer">
          {showRunningWarning ? (
            <>
              <button
                className="pill"
                data-testid="version-install-cancel-warning"
                onClick={() => setShowRunningWarning(false)}
              >
                {t('versionInstall.cancel')}
              </button>
              <button
                className="pill active"
                data-testid="version-install-confirm-quit"
                disabled={installing}
                onClick={() => void handleInstall(true)}
              >
                {t('versionInstall.confirmQuit')}
              </button>
            </>
          ) : (
            <>
              {targetVersion && (
                <button
                  className="pill"
                  data-testid="version-install-skip"
                  onClick={() => void handleSkip()}
                >
                  {t('versionInstall.skipVersion')}
                </button>
              )}
              <button
                className="pill"
                data-testid="version-install-later"
                onClick={handleDismiss}
              >
                {t('versionInstall.later')}
              </button>
              <button
                className="pill"
                data-testid="version-install-show"
                onClick={handleShowInFolder}
              >
                <FolderOpen size={14} />
                {t('versionInstall.showInFolder')}
              </button>
              <button
                className="pill active"
                data-testid="version-install-action"
                disabled={installing}
                onClick={() => void handleInstall(false)}
              >
                {t('versionInstall.installAndQuit')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
