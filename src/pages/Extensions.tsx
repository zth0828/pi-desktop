import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type {
  PiPackageCatalogFilterType,
  PiPackageCatalogResult,
  PiPackageCatalogRow,
  PiPackageCatalogSort,
  PiPackageRow,
  PiPackageUpdateInfo,
} from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { formatRelativeTime } from '../lib/session-format';

type ExtensionsView = 'discover' | 'installed';

function isCatalogPackageInstalled(item: PiPackageCatalogRow, packages: PiPackageRow[]): boolean {
  return packages.some((pkg) => pkg.name === item.name && pkg.source.startsWith('npm:'));
}

export default function ExtensionsPage() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ExtensionsView>('discover');
  const [packages, setPackages] = useState<PiPackageRow[]>([]);
  const [installedQuery, setInstalledQuery] = useState('');
  const [updates, setUpdates] = useState<PiPackageUpdateInfo[] | null>(null);
  const [source, setSource] = useState('');
  const [busySource, setBusySource] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [catalog, setCatalog] = useState<PiPackageCatalogResult>();
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogQuery, setCatalogQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [catalogType, setCatalogType] = useState<PiPackageCatalogFilterType>('');
  const [catalogSort, setCatalogSort] = useState<PiPackageCatalogSort>('downloads');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogNonce, setCatalogNonce] = useState(0);
  const unbindRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await hostApi.piPackages.list();
      setPackages(result.packages);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    unbindRef.current = onHostEvent('piPackages', 'progress', (event) => {
      setProgress(event.message ?? `${event.action}: ${event.source} (${event.type})`);
    });
    return () => unbindRef.current?.();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError(undefined);
    void hostApi.piPackages.catalog({
      name: submittedQuery || undefined,
      type: catalogType,
      sort: catalogSort,
      page: catalogPage,
    }).then((result) => {
      if (!active) return;
      setCatalog(result);
    }).catch((err) => {
      if (!active) return;
      setCatalogError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (active) setCatalogLoading(false);
    });
    return () => {
      active = false;
    };
  }, [catalogNonce, catalogPage, catalogSort, catalogType, submittedQuery]);

  const run = async (
    actionSource: string,
    action: () => Promise<{ success: boolean; error?: string }>,
    onSuccess?: () => void,
  ) => {
    setBusySource(actionSource);
    setError(undefined);
    try {
      const result = await action();
      if (!result.success) setError(result.error ?? 'unknown');
      else onSuccess?.();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySource(undefined);
    }
  };

  const installSource = () => run(source, async () => {
    const result = await hostApi.piPackages.install(source);
    if (result.success) setSource('');
    return result;
  });

  const installCatalogPackage = (item: PiPackageCatalogRow) => {
    const npmSource = `npm:${item.name}`;
    return run(npmSource, () => hostApi.piPackages.install(npmSource));
  };

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
    updates?.find((update) => update.source === pkg.source || update.displayName === pkg.name);

  const filteredPackages = useMemo(() => packages.filter((pkg) => (
    !installedQuery || `${pkg.name} ${pkg.source}`.toLowerCase().includes(installedQuery.toLowerCase())
  )), [installedQuery, packages]);

  const searchCatalog = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(catalogQuery.trim());
    setCatalogPage(1);
    setCatalogNonce((value) => value + 1);
  };

  const resetCatalog = () => {
    setCatalogQuery('');
    setSubmittedQuery('');
    setCatalogType('');
    setCatalogSort('downloads');
    setCatalogPage(1);
    setCatalogNonce((value) => value + 1);
  };

  return (
    <div className="extensions-page">
      <div className="extensions-header">
        <div>
          <h2>{t('extensions.title')}</h2>
          <p className="hint">{t('extensions.hint')}</p>
        </div>
        <button
          className="catalog-official-link"
          onClick={() => void hostApi.shell.openExternal('https://pi.dev/packages')}
        >
          {t('extensions.openOfficial')}
          <ExternalLink size={13} />
        </button>
      </div>

      <div className="extensions-tabs" role="tablist" aria-label={t('extensions.viewLabel')}>
        <button
          role="tab"
          aria-selected={view === 'discover'}
          className={view === 'discover' ? 'active' : ''}
          data-testid="extensions-tab-discover"
          onClick={() => setView('discover')}
        >
          <Search size={14} />
          {t('extensions.discover')}
        </button>
        <button
          role="tab"
          aria-selected={view === 'installed'}
          className={view === 'installed' ? 'active' : ''}
          data-testid="extensions-tab-installed"
          onClick={() => setView('installed')}
        >
          <PackageCheck size={14} />
          {t('extensions.installed')}
          <span className="extensions-tab-count">{packages.length}</span>
        </button>
      </div>

      {error && <p className="error-text" data-testid="packages-error">{error}</p>}
      {progress && busySource && <p className="hint" data-testid="packages-progress">{progress}</p>}

      {view === 'discover' ? (
        <div className="catalog-view" data-testid="package-catalog">
          <div className="catalog-security-notice">
            <ShieldAlert size={17} />
            <div>
              <strong>{t('extensions.securityTitle')}</strong>
              <p>{t('extensions.securityHint')}</p>
            </div>
          </div>

          <form className="catalog-action-bar" onSubmit={searchCatalog}>
            <label className="catalog-search-field">
              <Search size={15} />
              <input
                data-testid="catalog-search-input"
                type="search"
                placeholder={t('extensions.searchPlaceholder')}
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
              />
            </label>
            <select
              data-testid="catalog-type-filter"
              aria-label={t('extensions.filterType')}
              value={catalogType}
              onChange={(event) => {
                setCatalogType(event.target.value as PiPackageCatalogFilterType);
                setCatalogPage(1);
              }}
            >
              <option value="">{t('extensions.types.all')}</option>
              <option value="extension">{t('extensions.types.extension')}</option>
              <option value="skill">{t('extensions.types.skill')}</option>
              <option value="theme">{t('extensions.types.theme')}</option>
              <option value="prompt">{t('extensions.types.prompt')}</option>
            </select>
            <select
              data-testid="catalog-sort"
              aria-label={t('extensions.sortLabel')}
              value={catalogSort}
              onChange={(event) => {
                setCatalogSort(event.target.value as PiPackageCatalogSort);
                setCatalogPage(1);
              }}
            >
              <option value="downloads">{t('extensions.sort.downloads')}</option>
              <option value="recent">{t('extensions.sort.recent')}</option>
              <option value="name">{t('extensions.sort.name')}</option>
            </select>
            <button className="primary" data-testid="catalog-search" type="submit">
              {t('extensions.search')}
            </button>
            <button type="button" onClick={resetCatalog}>{t('extensions.reset')}</button>
          </form>

          <div className="catalog-result-heading">
            <div>
              <h3>{t('extensions.catalogTitle')}</h3>
              {catalog && !catalogLoading && (
                <p className="hint" data-testid="catalog-count">
                  {t('extensions.resultCount', {
                    start: catalog.start,
                    end: catalog.end,
                    total: catalog.totalCount,
                  })}
                </p>
              )}
            </div>
            <button
              className="icon-text-button"
              aria-label={t('extensions.retry')}
              disabled={catalogLoading}
              onClick={() => setCatalogNonce((value) => value + 1)}
            >
              <RefreshCw size={14} />
              {t('extensions.refresh')}
            </button>
          </div>

          {catalogError ? (
            <div className="catalog-error" data-testid="catalog-error">
              <p className="error-text">{catalogError}</p>
              <button onClick={() => setCatalogNonce((value) => value + 1)}>{t('extensions.retry')}</button>
            </div>
          ) : catalogLoading ? (
            <p className="hint" data-testid="catalog-loading">{t('extensions.loading')}</p>
          ) : catalog?.packages.length ? (
            <div className="catalog-grid">
              {catalog.packages.map((item) => {
                const installed = isCatalogPackageInstalled(item, packages);
                const npmSource = `npm:${item.name}`;
                return (
                  <article className="catalog-card" data-testid={`catalog-package-${item.name}`} key={item.name}>
                    <div className="catalog-card-topline">
                      <div className="catalog-package-types">
                        {item.types.map((type) => (
                          <span key={type}>{t(`extensions.types.${type}`)}</span>
                        ))}
                      </div>
                      {installed && <span className="catalog-installed-badge">{t('extensions.installedBadge')}</span>}
                    </div>
                    <div className="catalog-card-body">
                      <h4>{item.name}</h4>
                      <p>{item.description || t('extensions.noDescription')}</p>
                      <div className="catalog-meta">
                        <span>{item.author}</span>
                        <span>{t('extensions.downloads', {
                          count: new Intl.NumberFormat(i18n.language).format(item.downloads),
                        })}</span>
                        <span>
                          {item.publishedAt
                            ? formatRelativeTime(item.publishedAt, Date.now(), i18n.language)
                            : item.publishedLabel}
                        </span>
                      </div>
                    </div>
                    <div className="catalog-card-actions">
                      <button onClick={() => void hostApi.shell.openExternal(item.detailsUrl)}>
                        {t('extensions.details')}
                        <ExternalLink size={13} />
                      </button>
                      {installed ? (
                        <button
                          data-testid={`catalog-manage-${item.name}`}
                          onClick={() => setView('installed')}
                        >
                          {t('extensions.manage')}
                        </button>
                      ) : (
                        <button
                          className="primary"
                          data-testid={`catalog-install-${item.name}`}
                          disabled={Boolean(busySource)}
                          onClick={() => void installCatalogPackage(item)}
                        >
                          <Download size={13} />
                          {busySource === npmSource ? t('extensions.installing') : t('extensions.install')}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="hint" data-testid="catalog-empty">{t('extensions.catalogEmpty')}</p>
          )}

          {catalog && catalog.totalPages > 1 && (
            <div className="catalog-pagination">
              <button
                data-testid="catalog-previous"
                disabled={catalogPage <= 1 || catalogLoading}
                onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}
              >
                {t('extensions.previous')}
              </button>
              <span>{t('extensions.page', { page: catalog.page, total: catalog.totalPages })}</span>
              <button
                data-testid="catalog-next"
                disabled={catalogPage >= catalog.totalPages || catalogLoading}
                onClick={() => setCatalogPage((page) => page + 1)}
              >
                {t('extensions.next')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="installed-packages-view" data-testid="installed-packages">
          <div className="installed-toolbar">
            <input
              className="search-input"
              placeholder={t('extensions.searchInstalled')}
              value={installedQuery}
              onChange={(event) => setInstalledQuery(event.target.value)}
            />
            <div className="package-actions">
              <button data-testid="packages-check-updates" disabled={checking} onClick={() => void checkUpdates()}>
                {checking ? t('extensions.checking') : t('extensions.checkUpdates')}
              </button>
              {updates && updates.length > 0 && (
                <button
                  data-testid="packages-update-all"
                  disabled={Boolean(busySource)}
                  onClick={() => void run('update:all', () => hostApi.piPackages.update())}
                >
                  {t('extensions.updateAll', { count: updates.length })}
                </button>
              )}
              {updates && updates.length === 0 && (
                <span className="hint" data-testid="packages-up-to-date">{t('extensions.upToDate')}</span>
              )}
            </div>
          </div>

          {packages.length === 0 && !error ? (
            <p className="hint" data-testid="packages-empty">{t('extensions.empty')}</p>
          ) : filteredPackages.length === 0 ? (
            <p className="hint" data-testid="packages-filter-empty">{t('extensions.installedFilterEmpty')}</p>
          ) : (
            <div className="package-list">
              {filteredPackages.map((pkg) => (
                <div className="package-row" data-testid={`package-row-${pkg.name}`} key={`${pkg.scope}:${pkg.source}`}>
                  <div className="package-row-main">
                    <span className="package-name">{pkg.name}</span>
                    {pkg.version && <span className="hint">v{pkg.version}</span>}
                    <span className="package-scope-badge">{t(`extensions.scope.${pkg.scope}`)}</span>
                    {pkg.filtered && <span className="package-scope-badge">{t('extensions.filtered')}</span>}
                    {updateAvailable(pkg) && (
                      <span className="package-scope-badge" data-testid={`package-update-badge-${pkg.name}`}>
                        {t('extensions.updateAvailable')}
                      </span>
                    )}
                  </div>
                  <p className="package-path hint" title={pkg.source}>{pkg.source}</p>
                  <div className="package-actions">
                    {updateAvailable(pkg) && (
                      <button
                        data-testid={`package-update-${pkg.name}`}
                        disabled={Boolean(busySource)}
                        onClick={() => void run(`update:${pkg.source}`, () => hostApi.piPackages.update(pkg.source))}
                      >
                        {t('extensions.update')}
                      </button>
                    )}
                    <button
                      className="danger-outline"
                      data-testid={`package-remove-${pkg.name}`}
                      disabled={Boolean(busySource)}
                      onClick={() => void run(`remove:${pkg.source}`, () => hostApi.piPackages.remove(pkg.source, pkg.scope))}
                    >
                      {t('extensions.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <details className="advanced-package-install">
            <summary>{t('extensions.advancedInstall')}</summary>
            <p className="hint">{t('extensions.advancedInstallHint')}</p>
            <div className="extensions-install-form">
              <input
                data-testid="package-install-input"
                placeholder={t('extensions.installPlaceholder')}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
              <button
                className="primary"
                data-testid="package-install"
                disabled={Boolean(busySource) || !source.trim()}
                onClick={() => void installSource()}
              >
                {t('extensions.install')}
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
