import { ArrowLeft, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MouseEvent } from 'react';
import type { PiPackageDetail } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { formatRelativeTime } from '../lib/session-format';

type PackageDetailProps = {
  detail?: PiPackageDetail;
  loading: boolean;
  error?: string;
  installing: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onInstall: () => void;
};

function DetailLink({ label, url }: { label: string; url?: string }) {
  if (!url) return null;
  return (
    <button className="package-detail-link" onClick={() => void hostApi.shell.openExternal(url)}>
      {label}
      <ExternalLink size={13} />
    </button>
  );
}

export default function PackageDetail({
  detail,
  loading,
  error,
  installing,
  onBack,
  onRefresh,
  onInstall,
}: PackageDetailProps) {
  const { t, i18n } = useTranslation();
  const handleReadmeClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    try {
      const url = new URL(href, detail?.detailsUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        void hostApi.shell.openExternal(url.toString());
      }
    } catch {
      // Sanitized README links are optional; invalid links stay inert.
    }
  };

  return (
    <div className="package-detail-view" data-testid="package-detail">
      <div className="package-detail-toolbar">
        <button className="package-detail-back" data-testid="package-detail-back" onClick={onBack}>
          <ArrowLeft size={15} />
          {t('extensions.backToCatalog')}
        </button>
        <button
          className="icon-text-button"
          data-testid="package-detail-refresh"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
          {t('extensions.refresh')}
        </button>
      </div>

      {error && <p className="error-text" data-testid="package-detail-error">{error}</p>}
      {loading && !detail ? (
        <p className="hint" data-testid="package-detail-loading">{t('extensions.detailLoading')}</p>
      ) : detail ? (
        <>
          <header className="package-detail-hero">
            <div>
              <h3>{detail.name}</h3>
              <p>{detail.description || t('extensions.noDescription')}</p>
            </div>
            <div className="package-detail-actions">
              <button
                className="primary"
                data-testid="package-detail-install"
                disabled={installing}
                onClick={onInstall}
              >
                {installing ? t('extensions.installing') : t('extensions.install')}
              </button>
            </div>
          </header>

          <section className="package-detail-card package-detail-summary">
            <div className="package-detail-summary-topline">
              <div className="catalog-package-types">
                {detail.types.map((type) => <span key={type}>{t(`extensions.types.${type}`)}</span>)}
              </div>
              <div className="package-detail-links">
                <DetailLink label="npm" url={detail.npmUrl} />
                <DetailLink label={t('extensions.repository')} url={detail.repositoryUrl} />
                <DetailLink label={t('extensions.homepage')} url={detail.homepageUrl} />
                <DetailLink label={t('extensions.report')} url={detail.reportUrl} />
              </div>
            </div>

            <div className="package-install-command">
              <code>{detail.installCommand || `pi install npm:${detail.name}`}</code>
              <button onClick={() => void hostApi.app.writeClipboard(detail.installCommand || `pi install npm:${detail.name}`)}>
                {t('extensions.copyInstall')}
              </button>
            </div>

            <dl className="package-detail-definition-grid">
              <dt>{t('extensions.detailFields.package')}</dt><dd><code>{detail.name}</code></dd>
              {detail.version && <><dt>{t('extensions.detailFields.version')}</dt><dd><code>{detail.version}</code></dd></>}
              {detail.publishedLabel && <><dt>{t('extensions.detailFields.published')}</dt><dd>{detail.publishedAt ? formatRelativeTime(detail.publishedAt, Date.now(), i18n.language) : detail.publishedLabel}</dd></>}
              {detail.downloadsLabel && <><dt>{t('extensions.detailFields.downloads')}</dt><dd>{detail.downloadsLabel}</dd></>}
              {detail.author && <><dt>{t('extensions.detailFields.author')}</dt><dd>{detail.author}</dd></>}
              {detail.license && <><dt>{t('extensions.detailFields.license')}</dt><dd>{detail.license}</dd></>}
              {detail.sizeLabel && <><dt>{t('extensions.detailFields.size')}</dt><dd>{detail.sizeLabel}</dd></>}
              {detail.dependenciesLabel && <><dt>{t('extensions.detailFields.dependencies')}</dt><dd>{detail.dependenciesLabel}</dd></>}
            </dl>

            {detail.manifestJson && (
              <details className="package-manifest-disclosure">
                <summary>{t('extensions.manifest')}</summary>
                <pre>{detail.manifestJson}</pre>
              </details>
            )}
          </section>

          {detail.securityNote && (
            <section className="package-detail-card package-detail-security">
              <div className="package-detail-security-icon"><ShieldAlert size={17} /></div>
              <div><strong>{t('extensions.securityTitle')}</strong><p>{detail.securityNote}</p></div>
            </section>
          )}

          <section className="package-detail-card package-detail-readme">
            <h4>{t('extensions.readme')}</h4>
            {detail.readmeHtml ? (
              <div
                className="package-readme-rich-text"
                onClick={handleReadmeClick}
                dangerouslySetInnerHTML={{ __html: detail.readmeHtml }}
              />
            ) : (
              <p className="hint">{t('extensions.noReadme')}</p>
            )}
          </section>

          <p className="package-cache-status" data-testid="package-cache-status">
            {detail.cacheState === 'stale'
              ? t('extensions.cachedStale')
              : t('extensions.cachedAt', {
                time: formatRelativeTime(new Date(detail.fetchedAt).toISOString(), Date.now(), i18n.language),
              })}
          </p>
        </>
      ) : null}
    </div>
  );
}
