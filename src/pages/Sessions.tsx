import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCheck,
  Folder,
  FolderOpen,
  Pin,
  X,
} from 'lucide-react';
import type { PiSessionExportInfo, PiSessionExportRecord, PiSessionRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { groupByProject } from '../lib/session-groups';
import { formatRelativeTime, sessionDisplayTitle } from '../lib/session-format';
import { panesStore } from '../stores/panes-default';

type RowProps = {
  session: PiSessionRow;
  exportRecord?: PiSessionExportRecord;
  onChanged: () => void;
  onError: (message: string) => void;
  onExported: (path: string) => void;
  onRefreshExportInfo: () => void;
  onOpenChat: () => void;
  onDelete: (path: string) => Promise<void>;
  onArchive: (path: string, archived: boolean) => Promise<void>;
  onPin: (path: string, pinned: boolean) => Promise<void>;
};

function SessionRow({
  session,
  exportRecord,
  onChanged,
  onError,
  onExported,
  onRefreshExportInfo,
  onOpenChat,
  onDelete,
  onArchive,
  onPin,
}: RowProps) {
  const { t, i18n } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const formatShellError = (err?: string) => {
    if (!err) return t('sessions.actionFailedPlain');
    if (err === 'file-not-found' || err.includes('ENOENT')) {
      return t('sessions.exportFileNotFound');
    }
    return t('sessions.actionFailed', { error: err });
  };

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

  const runShellAction = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    const result = await action();
    if (!result.success) {
      onRefreshExportInfo();
      onError(formatShellError(result.error));
    }
  };

  // 已在某面板打开 → 聚焦该面板；否则替换活跃面板会话
  const switchTo = () => run(() => panesStore.getState().openOrFocusSession(session.path, session.cwd) ?? Promise.resolve({ success: true }), true);
  const fork = () => run(() => hostApi.piSessions.fork(session.path), true);
  const pin = () => onPin(session.path, !session.pinned);
  const archive = () => onArchive(session.path, !session.archived);
  const remove = () => onDelete(session.path);
  const exportHtml = async () => {
    setBusy(true);
    try {
      const result = await hostApi.piSessions.exportHtml(session.path, {
        cwd: session.cwd,
        title: session.name || session.firstMessage,
        id: session.id,
      });
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
          {session.pinned && (
            <span className="session-pinned-badge" data-testid="session-pinned" title={t('sessions.pinned')}>
              <Pin size={11} />
              {t('sessions.pinned')}
            </span>
          )}
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
          {exportRecord && (
            <span
              className="session-exported-badge"
              data-testid="session-exported"
              title={`${exportRecord.path}\n${t('sessions.openExportedTooltip')}`}
              onClick={(e) => {
                e.stopPropagation();
                void runShellAction(() => hostApi.shell.openPath(exportRecord.path));
              }}
            >
              <FileCheck size={12} />
              {t('sessions.exportedBadge')}
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
          <button data-testid="session-pin" disabled={busy || session.isRunning} onClick={() => void pin()}>
            {session.pinned ? t('sessions.unpin') : t('sessions.pin')}
          </button>
          <button data-testid="session-fork" disabled={busy || session.isRunning} onClick={() => void fork()}>
            {t('sessions.fork')}
          </button>
          {exportRecord ? (
            <>
              <button
                className="session-action-exported"
                data-testid="session-open-exported"
                title={t('sessions.openExportedTooltip')}
                disabled={busy}
                onClick={() => void runShellAction(() => hostApi.shell.openPath(exportRecord.path))}
              >
                <ExternalLink size={13} />
                {t('sessions.openExported')}
              </button>
              <button
                className="session-action-exported"
                data-testid="session-show-exported"
                title={t('sessions.showExportedInFolderTooltip')}
                disabled={busy}
                onClick={() => void runShellAction(() => hostApi.shell.showInFolder(exportRecord.path))}
              >
                <FolderOpen size={13} />
                {t('sessions.showExportedInFolder')}
              </button>
              <button
                data-testid="session-export"
                title={t('sessions.reExport')}
                disabled={busy}
                onClick={() => void exportHtml()}
              >
                {t('sessions.reExport')}
              </button>
            </>
          ) : (
            <button data-testid="session-export" disabled={busy} onClick={() => void exportHtml()}>
              {t('sessions.export')}
            </button>
          )}
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
  active?: boolean;
  onOpenChat: () => void;
};

export default function SessionsPage({ active = true, onOpenChat }: SessionsPageProps) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<PiSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [exportInfo, setExportInfo] = useState<PiSessionExportInfo>();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [exportCardCollapsed, setExportCardCollapsed] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasRecentExportsRef = useRef(false);
  hasRecentExportsRef.current = Boolean(exportInfo?.recentRecords && exportInfo.recentRecords.length > 0);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(undefined);
    }, 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const formatShellError = (err?: string) => {
    if (!err) return t('sessions.actionFailedPlain');
    if (err === 'file-not-found' || err.includes('ENOENT')) {
      return t('sessions.exportFileNotFound');
    }
    return t('sessions.actionFailed', { error: err });
  };

  const loadExportInfo = useCallback(async () => {
    try {
      const info = await hostApi.piSessions.getExportInfo();
      setExportInfo(info);
      hasRecentExportsRef.current = Boolean(info?.recentRecords && info.recentRecords.length > 0);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : String(err));
    }
  }, [showNotice]);

  const initialLoadedRef = useRef(false);

  const refreshSessions = useCallback((silent = false) => {
    if (!silent && !initialLoadedRef.current) {
      setLoading(true);
    }
    hostApi.piSessions
      .listAll()
      .then((r) => {
        setSessions(r.sessions);
        setLoadError(undefined);
        initialLoadedRef.current = true;
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // 仅在组件初次挂载时查询一次导出信息
  useEffect(() => {
    void loadExportInfo();
  }, [loadExportInfo]);

  // 当会话页面激活时静默同步最新会话；仅在已有最近导出时才复查导出磁盘文件
  useEffect(() => {
    if (active) {
      refreshSessions(true);
      if (hasRecentExportsRef.current) {
        void loadExportInfo();
      }
    }
  }, [active, refreshSessions, loadExportInfo]);

  // 当窗口获得焦点时静默刷新会话列表；仅在已有最近导出时才复查导出磁盘文件
  useEffect(() => {
    const handleFocus = () => {
      if (active) {
        refreshSessions(true);
        if (hasRecentExportsRef.current) {
          void loadExportInfo();
        }
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [active, refreshSessions, loadExportInfo]);

  useEffect(() => {
    const onSessionUpdate = () => refreshSessions(true);
    const unbindReplaced = onHostEvent('piRuntime', 'sessionReplaced', onSessionUpdate);
    const unbindState = onHostEvent('piRuntime', 'runtimeStateChanged', onSessionUpdate);
    const unbindChanged = onHostEvent('piRuntime', 'sessionsChanged', onSessionUpdate);
    return () => {
      unbindReplaced();
      unbindState();
      unbindChanged();
    };
  }, [refreshSessions]);

  const runShellAction = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    const result = await action();
    if (!result.success) {
      if (hasRecentExportsRef.current) {
        void loadExportInfo();
      }
      showNotice(formatShellError(result.error));
    }
  };

  const onExported = (_lastPath: string) => {
    void loadExportInfo();
  };

  const handleDelete = async (sessionPath: string) => {
    const previous = sessions;
    setSessions((prev) => prev.filter((s) => s.path !== sessionPath));
    try {
      const result = await hostApi.piSessions.remove(sessionPath);
      if (!result.success) {
        setSessions(previous);
        showNotice(result.error ?? t('sessions.actionFailedPlain'));
      }
    } catch (err) {
      setSessions(previous);
      showNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const handleArchive = async (sessionPath: string, archived: boolean) => {
    const previous = sessions;
    setSessions((prev) =>
      prev.map((s) => (s.path === sessionPath ? { ...s, archived } : s)),
    );
    try {
      const result = await hostApi.piSessions.archive(sessionPath, archived);
      if (!result.success) {
        setSessions(previous);
        showNotice(result.error ?? t('sessions.actionFailedPlain'));
      }
    } catch (err) {
      setSessions(previous);
      showNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePin = async (sessionPath: string, pinned: boolean) => {
    const previous = sessions;
    setSessions((prev) =>
      prev.map((s) => (s.path === sessionPath ? { ...s, pinned } : s)),
    );
    try {
      const result = await hostApi.piSessions.pin(sessionPath, pinned);
      if (!result.success) {
        setSessions(previous);
        showNotice(result.error ?? t('sessions.actionFailedPlain'));
      }
    } catch (err) {
      setSessions(previous);
      showNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const groups = useMemo(() => groupByProject(sessions), [sessions]);

  const [isScrolled, setIsScrolled] = useState(false);

  const updateScrollAffordance = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsScrolled(el.scrollTop > 8);
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const hasOverflow = el.scrollHeight > el.clientHeight + 40;
    setShowScrollToBottom(hasOverflow && distanceFromBottom > 100);
  }, []);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => updateScrollAffordance();
    updateScrollAffordance();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateScrollAffordance]);

  useEffect(() => {
    updateScrollAffordance();
  }, [sessions, exportInfo, collapsedGroups, exportCardCollapsed, updateScrollAffordance]);

  const allCollapsed = useMemo(() => {
    if (groups.length === 0) return false;
    return groups.every((g) => collapsedGroups[g.cwd]);
  }, [groups, collapsedGroups]);

  const toggleAllGroups = () => {
    if (allCollapsed) {
      setCollapsedGroups({});
    } else {
      const next: Record<string, boolean> = {};
      for (const g of groups) {
        next[g.cwd] = true;
      }
      setCollapsedGroups(next);
    }
  };

  const toggleGroup = (cwd: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [cwd]: !prev[cwd],
    }));
  };

  return (
    <div className="sessions-page-wrapper">
      <div className={`sessions-header-bar${isScrolled ? ' is-scrolled' : ''}`}>
        <div className="sessions-header">
          <h2>{t('sessions.title')}</h2>
          {groups.length > 0 && (
            <button
              className="pill session-collapse-all-btn"
              data-testid="sessions-collapse-all"
              onClick={toggleAllGroups}
              title={allCollapsed ? t('sessions.expandAll') : t('sessions.collapseAll')}
            >
              {allCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              <span>{allCollapsed ? t('sessions.expandAll') : t('sessions.collapseAll')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="sessions-page" ref={containerRef} onScroll={updateScrollAffordance}>
        {loading && sessions.length === 0 && (
          <p className="hint" data-testid="sessions-loading">
            {t('states.loading')}
          </p>
        )}
        {notice && (
          <div className="sessions-notice-banner" data-testid="sessions-error">
            <AlertCircle size={15} />
            <span className="sessions-notice-text">{notice}</span>
            <button
              className="sessions-notice-close"
              data-testid="sessions-error-dismiss"
              onClick={() => setNotice(undefined)}
              title={t('sessions.actionErrorDismiss')}
            >
              <X size={13} />
            </button>
          </div>
        )}
        {loadError && (
          <div className="sessions-notice-banner fatal" data-testid="sessions-load-error">
            <AlertCircle size={15} />
            <span className="sessions-notice-text">{loadError}</span>
            <button data-testid="sessions-retry" className="pill" onClick={() => refreshSessions(false)}>
              {t('states.retry')}
            </button>
          </div>
        )}
        {exportInfo?.recentRecords && exportInfo.recentRecords.length > 0 && (
          <div className="session-export-card" data-testid="sessions-export-info">
            <div className="session-export-card-header">
              <div
                className="session-export-card-title session-export-collapsible"
                data-testid="sessions-export-toggle"
                onClick={() => setExportCardCollapsed((prev) => !prev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExportCardCollapsed((prev) => !prev);
                  }
                }}
                aria-expanded={!exportCardCollapsed}
                title={exportCardCollapsed ? t('sessions.expandExports') : t('sessions.collapseExports')}
              >
                <ChevronDown
                  size={14}
                  className={`session-chevron${exportCardCollapsed ? ' collapsed' : ''}`}
                />
                <strong>{t('sessions.recentExports')}</strong>
                <span className="session-export-count-badge">
                  {exportInfo.recentRecords.length}
                </span>
              </div>
              <button
                className="pill session-export-folder-btn"
                data-testid="sessions-show-export"
                title={t('sessions.openExportFolder')}
                onClick={() => void runShellAction(() => hostApi.shell.openPath(exportInfo.directory))}
              >
                <FolderOpen size={13} />
                {t('sessions.openExportFolder')}
              </button>
            </div>

            {!exportCardCollapsed && (
              <div className="session-recent-exports-list" data-testid="sessions-recent-list">
                {exportInfo.recentRecords.map((record) => {
                  const fileName = record.path.split(/[\\/]/).pop();
                  return (
                    <div className="session-recent-export-item" key={record.path} data-testid="session-recent-item">
                      <div className="session-recent-export-info">
                        <div className="session-recent-export-main">
                          {record.projectName && (
                            <span className="session-export-project-badge" title={record.cwd}>
                              <Folder size={11} />
                              {record.projectName}
                            </span>
                          )}
                          <span className="session-recent-export-title" title={record.title}>
                            {record.title}
                          </span>
                        </div>
                        <div className="session-recent-export-sub hint">
                          <span className="session-recent-export-filename" title={record.path}>
                            {fileName}
                          </span>
                          {record.exportedAt && (
                            <>
                              <span>·</span>
                              <span>{formatRelativeTime(record.exportedAt, Date.now(), i18n.language)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="session-recent-export-actions">
                        <button
                          className="pill"
                          data-testid="sessions-open-export"
                          title={t('sessions.openExportedTooltip')}
                          onClick={() => void runShellAction(() => hostApi.shell.openPath(record.path))}
                        >
                          <ExternalLink size={13} />
                          {t('sessions.openExport')}
                        </button>
                        <button
                          className="pill"
                          data-testid="sessions-show-export-item"
                          title={t('sessions.showExportedInFolderTooltip')}
                          onClick={() => void runShellAction(() => hostApi.shell.showInFolder(record.path))}
                        >
                          <FolderOpen size={13} />
                          {t('sessions.showInFolder')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!loading && !loadError && groups.length === 0 ? (
          <p className="hint" data-testid="sessions-empty">{t('sessions.emptyAll')}</p>
        ) : (
          <div className="session-list">
            {groups.map((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.cwd]);
              return (
                <div className="session-project-group" key={group.cwd}>
                  <div
                    className="session-project-header"
                    data-testid={`session-project-${group.name}`}
                    onClick={() => toggleGroup(group.cwd)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleGroup(group.cwd);
                      }
                    }}
                    aria-expanded={!isCollapsed}
                    title={isCollapsed ? t('sessions.expandGroup') : t('sessions.collapseGroup')}
                  >
                    <ChevronDown
                      size={14}
                      className={`session-chevron${isCollapsed ? ' collapsed' : ''}`}
                    />
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
                      onClick={(e) => {
                        e.stopPropagation();
                        void runShellAction(() => hostApi.shell.openPath(group.cwd));
                      }}
                    >
                      <FolderOpen size={13} />
                      {t('sessions.openProjectFolder')}
                    </button>
                  </div>
                  {!isCollapsed && group.sessions.map((s) => (
                    <SessionRow
                      key={s.path}
                      session={s}
                      exportRecord={exportInfo?.records?.[s.path]}
                      onChanged={refreshSessions}
                      onError={showNotice}
                      onExported={onExported}
                      onRefreshExportInfo={loadExportInfo}
                      onOpenChat={onOpenChat}
                      onDelete={handleDelete}
                      onArchive={handleArchive}
                      onPin={handlePin}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showScrollToBottom && (
        <button
          className="sessions-scroll-to-bottom"
          data-testid="sessions-scroll-to-bottom"
          type="button"
          onClick={scrollToBottom}
          title={t('sessions.scrollToBottom')}
          aria-label={t('sessions.scrollToBottom')}
        >
          <ArrowDown size={14} aria-hidden="true" />
          <span>{t('sessions.scrollToBottom')}</span>
        </button>
      )}
    </div>
  );
}
