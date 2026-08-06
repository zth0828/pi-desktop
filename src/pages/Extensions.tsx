import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiPackageRow, PiPackageUpdateInfo } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';

export default function ExtensionsPage() {
  const { t } = useTranslation();
  const [packages, setPackages] = useState<PiPackageRow[]>([]);
  const [updates, setUpdates] = useState<PiPackageUpdateInfo[] | null>(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const unbindRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    hostApi.piPackages
      .list()
      .then((r) => {
        setPackages(r.packages);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    unbindRef.current = onHostEvent('piPackages', 'progress', (e) => {
      setProgress(e.message ?? `${e.action}: ${e.source} (${e.type})`);
    });
    return () => unbindRef.current?.();
  }, [refresh]);

  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await action();
      if (!result.success) setError(result.error ?? 'unknown');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const install = () => run(async () => {
    const result = await hostApi.piPackages.install(source);
    if (result.success) setSource('');
    return result;
  });

  const checkUpdates = async () => {
    setChecking(true);
    setError(undefined);
    try {
      const result = await hostApi.piPackages.checkUpdates();
      setUpdates(result.updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const updateAvailable = (pkg: PiPackageRow) =>
    updates?.find((u) => u.source === pkg.source || u.displayName === pkg.name);

  return (
    <div className="extensions-page">
      <h2>{t('extensions.title')}</h2>
      <p className="hint">{t('extensions.hint')}</p>

      <div className="extensions-install-form">
        <input
          data-testid="package-install-input"
          placeholder={t('extensions.installPlaceholder')}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <button
          className="primary"
          data-testid="package-install"
          disabled={busy || !source.trim()}
          onClick={() => void install()}
        >
          {t('extensions.install')}
        </button>
      </div>

      {error && <p className="error-text" data-testid="packages-error">{error}</p>}
      {progress && busy && <p className="hint" data-testid="packages-progress">{progress}</p>}

      <div className="package-actions">
        <button data-testid="packages-check-updates" disabled={checking} onClick={() => void checkUpdates()}>
          {checking ? t('extensions.checking') : t('extensions.checkUpdates')}
        </button>
        {updates && updates.length > 0 && (
          <button
            data-testid="packages-update-all"
            disabled={busy}
            onClick={() => void run(() => hostApi.piPackages.update())}
          >
            {t('extensions.updateAll', { count: updates.length })}
          </button>
        )}
        {updates && updates.length === 0 && (
          <span className="hint" data-testid="packages-up-to-date">{t('extensions.upToDate')}</span>
        )}
      </div>

      {packages.length === 0 && !error ? (
        <p className="hint" data-testid="packages-empty">{t('extensions.empty')}</p>
      ) : (
        <div className="package-list">
          {packages.map((p) => (
            <div className="package-row" data-testid={`package-row-${p.name}`} key={`${p.scope}:${p.source}`}>
              <div className="package-row-main">
                <span className="package-name">{p.name}</span>
                {p.version && <span className="hint">v{p.version}</span>}
                <span className="package-scope-badge">{t(`extensions.scope.${p.scope}`)}</span>
                {p.filtered && <span className="package-scope-badge">{t('extensions.filtered')}</span>}
                {updateAvailable(p) && (
                  <span className="package-scope-badge" data-testid={`package-update-badge-${p.name}`}>
                    {t('extensions.updateAvailable')}
                  </span>
                )}
              </div>
              <p className="package-path hint" title={p.source}>{p.source}</p>
              <div className="package-actions">
                {updateAvailable(p) && (
                  <button
                    data-testid={`package-update-${p.name}`}
                    disabled={busy}
                    onClick={() => void run(() => hostApi.piPackages.update(p.source))}
                  >
                    {t('extensions.update')}
                  </button>
                )}
                <button
                  className="danger-outline"
                  data-testid={`package-remove-${p.name}`}
                  disabled={busy}
                  onClick={() => void run(() => hostApi.piPackages.remove(p.source, p.scope))}
                >
                  {t('extensions.remove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
