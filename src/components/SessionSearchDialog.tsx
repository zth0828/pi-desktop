import { useEffect, useRef, useState } from 'react';
import { Archive, LoaderCircle, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PiSessionSearchRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenChat: (target?: { sessionId: string; messageIndex: number }) => void;
};

function projectName(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.at(-1) || cwd;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  if (index < 0 || !query.trim()) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.trim().length)}</mark>
      {text.slice(index + query.trim().length)}
    </>
  );
}

export function SessionSearchDialog({ open, onClose, onOpenChat }: Props) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PiSessionSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectingPath, setSelectingPath] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setError('');
    setSelectingPath('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void hostApi.piSessions.search(trimmed)
        .then((result) => {
          if (!cancelled) setResults(result.sessions);
        })
        .catch((searchError) => {
          if (!cancelled) setError(searchError instanceof Error ? searchError.message : String(searchError));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  if (!open) return null;

  const openSession = async (session: PiSessionSearchRow) => {
    setSelectingPath(session.path);
    setError('');
    try {
      const result = await hostApi.piSessions.switch(session.path, session.cwd);
      if (!result.success) {
        setError(result.error || t('sessionSearch.switchFailed'));
        return;
      }
      onClose();
      onOpenChat(session.messageIndex === undefined
        ? undefined
        : { sessionId: session.id, messageIndex: session.messageIndex });
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    } finally {
      setSelectingPath('');
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' });

  return (
    <div className="session-search-overlay" data-testid="session-search-dialog" onMouseDown={onClose}>
      <section
        className="session-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('sessionSearch.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="session-search-field">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            data-testid="session-search-input"
            type="search"
            value={query}
            placeholder={t('sessionSearch.placeholder')}
            aria-label={t('sessionSearch.title')}
            onChange={(event) => setQuery(event.target.value)}
          />
          {loading ? <LoaderCircle className="session-search-spinner" size={17} aria-label={t('sessionSearch.loading')} /> : (
            <button className="icon-button" title={t('sessionSearch.close')} aria-label={t('sessionSearch.close')} onClick={onClose}>
              <X size={17} />
            </button>
          )}
        </div>

        <div className="session-search-results" aria-live="polite">
          {error && <p className="session-search-state error-text" data-testid="session-search-error">{error}</p>}
          {!error && query.trim() && !loading && results.length === 0 && (
            <p className="session-search-state" data-testid="session-search-empty">{t('sessionSearch.empty')}</p>
          )}
          {!error && !query.trim() && (
            <p className="session-search-state">{t('sessionSearch.prompt')}</p>
          )}
          {results.map((session) => (
            <button
              key={session.path}
              className="session-search-result"
              data-testid={`session-search-result-${session.id}`}
              disabled={Boolean(selectingPath)}
              onClick={() => void openSession(session)}
            >
              <span className="session-search-result-heading">
                <strong>
                  <HighlightedText
                    text={session.name || session.firstMessage || t('sessions.untitled')}
                    query={query}
                  />
                </strong>
                {session.archived && (
                  <span className="session-search-archived"><Archive size={12} />{t('sessions.archived')}</span>
                )}
              </span>
              <span className="session-search-snippet">
                <HighlightedText text={session.snippet || session.firstMessage} query={query} />
              </span>
              <span className="session-search-meta">
                <span>{projectName(session.cwd)}</span>
                <span>{t(`sessionSearch.match.${session.match}`)}</span>
                <time dateTime={session.modified}>{dateFormatter.format(new Date(session.modified))}</time>
                {selectingPath === session.path && <LoaderCircle className="session-search-spinner" size={13} />}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
