import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ChevronDown, MapPin, WrapText, X } from 'lucide-react';
import type { ShellApplication, WorkspaceReadResult } from '@shared/host-api/contract';
import { hostApi } from '../../../lib/host-api';
import { FileIcon } from '../../../components/FileIcon';
import { FilePreviewContent } from '../FilePreviewContent';
import { formatBytes, rankApplications } from './types';

export function OpenWithMenu({ absolutePath }: { absolutePath: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [applications, setApplications] = useState<ShellApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || applications.length > 0 || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await hostApi.shell.listApplications();
      // 菜单只展示最相关的少量应用；列表本身仍由 Main 动态发现。
      setApplications(rankApplications(result.applications).slice(0, 8));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const openApplication = async (application: ShellApplication) => {
    setOpen(false);
    const result = await hostApi.shell.openPathWith(absolutePath, application);
    if (!result.success) setError(result.error ?? t('workspace.openFailed'));
  };

  return (
    <div className="workspace-open-menu" ref={menuRef}>
      <button
        className="workspace-open-trigger"
        data-testid="workspace-open-with"
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        <AppWindow size={14} />
        <span>{t('workspace.openWith')}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="workspace-open-popover" data-testid="workspace-open-menu">
          <button
            onClick={() => {
              setOpen(false);
              void hostApi.shell.showInFolder(absolutePath);
            }}
          >
            <MapPin size={15} />
            <span>{t('workspace.showInFolder')}</span>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              void hostApi.shell.openPath(absolutePath);
            }}
          >
            <AppWindow size={15} />
            <span>{t('workspace.defaultApplication')}</span>
          </button>
          <div className="workspace-open-separator" />
          {loading && <div className="workspace-open-state">{t('workspace.findingApps')}</div>}
          {!loading &&
            applications.map((application) => (
              <button
                key={application.id}
                data-testid="workspace-open-application"
                onClick={() => void openApplication(application)}
              >
                {application.iconDataUrl ? (
                  <img className="workspace-application-icon" src={application.iconDataUrl} alt="" />
                ) : (
                  <AppWindow size={15} />
                )}
                <span>{application.name}</span>
              </button>
            ))}
          {!loading && applications.length === 0 && (
            <div className="workspace-open-state">{t('workspace.noApps')}</div>
          )}
        </div>
      )}
      {error && (
        <div className="workspace-open-error" role="status">
          {error}
        </div>
      )}
    </div>
  );
}

export function FilePreview({ path, onClose }: { path: string; onClose?: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<WorkspaceReadResult | null>(null);
  const [error, setError] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    setWrapLines(true);
    void hostApi.workspace
      .readFile(path)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <div className="workspace-empty">{t('workspace.readFailed')}</div>;
  if (!result) return <div className="workspace-empty">{t('workspace.loading')}</div>;

  return (
    <div className="workspace-file-view">
      <header className="workspace-file-header">
        <div className="workspace-file-title">
          <FileIcon name={result.name} size={16} />
          <span title={result.path}>{result.name}</span>
          <small>{formatBytes(result.size)}</small>
        </div>
        <div className="workspace-file-actions">
          {(result.kind === 'text' || result.kind === 'markdown') && (
            <button
              className={`icon-button${wrapLines ? ' active' : ''}`}
              data-testid="workspace-toggle-wrap"
              aria-pressed={wrapLines}
              title={wrapLines ? t('workspace.disableWrap') : t('workspace.enableWrap')}
              onClick={() => setWrapLines((current) => !current)}
            >
              <WrapText size={15} />
            </button>
          )}
          <OpenWithMenu absolutePath={result.absolutePath} />
          {onClose && (
            <button
              type="button"
              className="icon-button"
              data-testid="workspace-preview-close"
              title={t('workspace.close')}
              aria-label={t('workspace.close')}
              onClick={onClose}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </header>
      <div className="workspace-file-content">
        <FilePreviewContent result={result} wrapLines={wrapLines} />
      </div>
    </div>
  );
}
