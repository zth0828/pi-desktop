import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiSessionRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { formatRelativeTime, sessionDisplayTitle } from '../lib/session-format';

type RowProps = {
  session: PiSessionRow;
  onChanged: () => void;
  onError: (message: string) => void;
  onExported: (path: string) => void;
};

function SessionRow({ session, onChanged, onError, onExported }: RowProps) {
  const { t, i18n } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) onError(result.error ?? 'unknown');
      else onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = () => run(() => hostApi.piSessions.switch(session.path));
  const fork = () => run(() => hostApi.piSessions.fork(session.path));
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
            disabled={busy}
            onClick={() => {
              setName(session.name ?? session.firstMessage);
              setRenaming(true);
            }}
          >
            {t('sessions.rename')}
          </button>
          <button data-testid="session-fork" disabled={busy} onClick={() => void fork()}>
            {t('sessions.fork')}
          </button>
          <button data-testid="session-export" disabled={busy} onClick={() => void exportHtml()}>
            {t('sessions.export')}
          </button>
          <button data-testid="session-archive" disabled={busy} onClick={() => void archive()}>
            {session.archived ? t('sessions.unarchive') : t('sessions.archive')}
          </button>
          {confirmingDelete ? (
            <>
              <button
                className="danger-outline"
                data-testid="session-delete-confirm"
                disabled={busy}
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
              disabled={busy}
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

export default function SessionsPage() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PiSessionRow[]>([]);
  const [error, setError] = useState<string>();
  const [exported, setExported] = useState<string>();

  const refresh = useCallback(() => {
    hostApi.piSessions
      .list()
      .then((r) => {
        setSessions(r.sessions);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="sessions-page">
      <h2>{t('sessions.title')}</h2>
      {error && <p className="error-text" data-testid="sessions-error">{error}</p>}
      {exported && (
        <p className="hint" data-testid="sessions-exported">
          {t('sessions.exported', { path: exported })}
        </p>
      )}
      {sessions.length === 0 && !error ? (
        <p className="hint" data-testid="sessions-empty">{t('sessions.empty')}</p>
      ) : (
        <div className="session-list">
          {sessions.map((s) => (
            <SessionRow
              key={s.path}
              session={s}
              onChanged={refresh}
              onError={setError}
              onExported={setExported}
            />
          ))}
        </div>
      )}
    </div>
  );
}
