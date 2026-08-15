import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Folder, FolderOpen } from 'lucide-react';
import type { PiSessionExportInfo, PiSessionRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { groupByProject } from '../lib/session-groups';
import { formatRelativeTime, sessionDisplayTitle } from '../lib/session-format';
import { useChatStore } from '../stores/chat';

type RowProps = {
  session: PiSessionRow;
  onChanged: () => void;
  onError: (message: string) => void;
  onExported: (path: string) => void;
  onOpenChat: () => void;
};

function SessionRow({ session, onChanged, onError, onExported, onOpenChat }: RowProps) {
  const { t, i18n } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (
    action: () => Promise<{ success: boolean; error?: string }>,
    openChatOnSuccess = false,
  ) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) onError(result.error ?? 'unknown');
      else {
        onChanged();
        if (openChatOnSuccess) onOpenChat();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = () => run(() => useChatStore.getState().switchSession(session.path, session.cwd), true);
  const fork = () => run(() => hostApi.piSessions.fork(session.path), true);
  const archive = () => run(() => hostApi.piSessions.archive(session.path, !session.archived));
  const remove = () => run(() => hostApi.piSessions.remove(session.path));
  const exportHtml = async () => {
    setBusy(true);
    try {
      const result = await hostApi.piSessions.exportHtml(session.path);
      if (result.success && result.path) onExported(result.path);
      else if (!result.success) onError(result.error ?? 'unknown');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const saveRename = () =>
    run(async () => {
      const result = await hostApi.piSessions.rename(session.path, name);
      if (result.success) setRenaming(false);
      return result;
    });

  return (
    <div
      className={session.isCurrent ? 'session-row current' : 'session-row'}
      data-testid={`session-row-${session.id}`}
      data-current={session.isCurrent || undefined}
    >
      <button className="session-row-main" disabled={busy} onClick={() => void switchTo()}>
        <span className="session-title" data-testid="session-title">
          {sessionDisplayTitle(session) || t('sessions.untitled')}
        </span>
        <span className="session-meta hint">
          {session.isCurrent && (
            <span className="session-current-badge" data-testid="session-current">
              {t('sessions.current')}
            </span>
          )}
          {session.isRunning && (
            <span className="session-running-badge" title={t('sessions.running')}>
              {t('sessions.running')}
            </span>
          )}
          {t('sessions.messageCount', { count: session.messageCount })}
          {' · '}
          {formatRelativeTime(session.modified, Date.now(), i18n.language)}
        </span>
      </button>
      {renaming ? (
        <div className="rename-form">
          <input
            data-testid="session-rename-input"
            placeholder={t('sessions.renamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" disabled={busy || !name.trim()} onClick={() => void saveRename()}>
            {t('sessions.save')}
          </button>
          <button onClick={() => setRenaming(false)}>{t('sessions.cancel')}</button>
        </div>
      ) : (
        <div className="session-actions">
          <button
            data-testid="session-rename"
            disabled={busy || session.isRunning}
            onClick={() => {
              setName(session.name ?? session.firstMessage);
              setRenaming(true);
            }}
          >
            {t('sessions.rename')}
          </button>
          <button data-testid="session-fork" disabled={busy || session.isRunning} onClick={() => void fork()}>
            {t('sessions.fork')}
          </button>
          <button data-testid="session-export" disabled={busy} onClick={() => void exportHtml()}>
            {t('sessions.export')}
          </button>
          <button data-testid="session-archive" disabled={busy || session.isRunning} onClick={() => void archive()}>
            {session.archived ? t('sessions.unarchive') : t('sessions.archive')}
          </button>
          {confirmingDelete ? (
            <>
              <button
                className="danger-outline"
                data-testid="session-delete-confirm"
                disabled={busy || session.isRunning}
                onClick={() => void remove()}
              >
                {t('sessions.confirmDelete')}
              </button>
              <button onClick={() => setConfirmingDelete(false)}>{t('sessions.cancel')}</button>
            </>
          ) : (
            <button
              className="danger-outline"
              data-testid="session-delete"
              disabled={busy || session.isRunning}
              onClick={() => setConfirmingDelete(true)}
            >
              {t('sessions.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type SessionsPageProps = {
  onOpenChat: () => void;
};

export default function SessionsPage({ onOpenChat }: SessionsPageProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PiSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [exportInfo, setExportInfo] = useState<PiSessionExportInfo>();

  const refresh = useCallback(() => {
    setLoading(true);
    hostApi.piSessions
      .listAll()
      .then((r) => {
        setSessions(r.sessions);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const unbindReplaced = onHostEvent('piRuntime', 'sessionReplaced', refresh);
    const unbindState = onHostEvent('piRuntime', 'runtimeStateChanged', refresh);
    const unbindChanged = onHostEvent('piRuntime', 'sessionsChanged', refresh);
    return () => {
      unbindReplaced();
      unbindState();
      unbindChanged();
    };
  }, [refresh]);

  useEffect(() => {
    void hostApi.piSessions.getExportInfo().then(setExportInfo).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const runShellAction = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    const result = await action();
    if (!result.success) setError(result.error ?? 'unknown');
  };

  const onExported = (lastPath: string) => {
    setExportInfo((current) => ({
      directory: current?.directory ?? lastPath.replace(/[\\/][^\\/]+$/, ''),
      lastPath,
    }));
  };

  const lastExportName = exportInfo?.lastPath?.split(/[\\/]/).pop();

  const groups = useMemo(() => groupByProject(sessions), [sessions]);

  return (
    <div className="sessions-page">
      <h2>{t('sessions.title')}</h2>
      {loading && (
        <p className="hint" data-testid="sessions-loading">
          {t('states.loading')}
        </p>
      )}
      {error && (
        <div data-testid="sessions-error">
          <p className="error-text">{error}</p>
          <button data-testid="sessions-retry" onClick={refresh}>
            {t('states.retry')}
          </button>
        </div>
      )}
      {exportInfo && (
        <div className="session-export-status" data-testid="sessions-export-info">
          <div className="session-export-copy">
            <strong>{lastExportName ? t('sessions.lastExport') : t('sessions.exportLocation')}</strong>
            <span className="hint" title={exportInfo.lastPath ?? exportInfo.directory}>
              {lastExportName ?? exportInfo.directory}
            </span>
          </div>
          <div className="session-export-actions">
            {exportInfo.lastPath && (
              <button
                className="pill"
                data-testid="sessions-open-export"
                onClick={() => void runShellAction(() => hostApi.shell.openPath(exportInfo.lastPath!))}
              >
                <ExternalLink size={14} />
                {t('sessions.openExport')}
              </button>
            )}
            <button
              className="pill"
              data-testid="sessions-show-export"
              onClick={() => void runShellAction(() => exportInfo.lastPath
                ? hostApi.shell.showInFolder(exportInfo.lastPath)
                : hostApi.shell.openPath(exportInfo.directory))}
            >
              <FolderOpen size={14} />
              {exportInfo.lastPath ? t('sessions.showInFolder') : t('sessions.openExportFolder')}
            </button>
          </div>
        </div>
      )}
      {!loading && !error && sessions.length === 0 ? (
        <p className="hint" data-testid="sessions-empty">{t('sessions.emptyAll')}</p>
      ) : (
        <div className="session-list">
          {groups.map((group) => (
            <div className="session-project-group" key={group.cwd}>
              <div className="session-project-header" data-testid={`session-project-${group.name}`}>
                <Folder size={14} />
                <span className="session-project-name" title={group.cwd}>
                  {group.name}
                </span>
                <span className="session-project-path hint" title={group.cwd}>
                  {group.cwd}
                </span>
                <span className="session-project-count">
                  {t('sessions.projectCount', { count: group.sessions.length })}
                </span>
                <button
                  className="pill session-project-open"
                  data-testid={`session-project-open-${group.name}`}
                  title={t('sessions.openProjectFolder')}
                  onClick={() => void runShellAction(() => hostApi.shell.openPath(group.cwd))}
                >
                  <FolderOpen size={13} />
                  {t('sessions.openProjectFolder')}
                </button>
              </div>
              {group.sessions.map((s) => (
                <SessionRow
                  key={s.path}
                  session={s}
                  onChanged={refresh}
                  onError={setError}
                  onExported={onExported}
                  onOpenChat={onOpenChat}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
