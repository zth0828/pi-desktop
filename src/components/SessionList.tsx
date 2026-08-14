import { useEffect, useMemo, useState } from 'react';
import { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  GitFork,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { PiSessionRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { groupByProject, type ProjectGroup } from '../lib/session-groups';
import { useChatStore } from '../stores/chat';

type MenuPosition = { left: number; top: number };

const SESSION_PAGE_SIZE = 10;
const MENU_WIDTH = 196;
const SESSION_MENU_HEIGHT = 246;
const PROJECT_MENU_HEIGHT = 48;

type SessionListProps = {
  onOpenChat: () => void;
};

/** 侧栏会话列表：按项目分组，支持项目/会话归档与删除。 */
export function SessionList({ onOpenChat }: SessionListProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PiSessionRow[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [renamePath, setRenamePath] = useState<string>();
  const [renameValue, setRenameValue] = useState('');
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const refreshSequence = useRef(0);
  const started = useChatStore((s) => s.started);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeCwd = useChatStore((s) => s.cwd);

  const refresh = useCallback(() => {
    const sequence = ++refreshSequence.current;
    void hostApi.piSessions
      .listAll()
      .then((r) => {
        if (sequence === refreshSequence.current) setSessions(r.sessions);
      })
      .catch(() => {});
  }, []);

  const refreshAfterSessionChange = useCallback(() => {
    refresh();
    window.setTimeout(refresh, 150);
    window.setTimeout(refresh, 500);
  }, [refresh]);

  useEffect(() => {
    if (started) refreshAfterSessionChange();
    const unbindSession = onHostEvent('piRuntime', 'sessionReplaced', refreshAfterSessionChange);
    const unbindRuntime = onHostEvent('piRuntime', 'runtimeStateChanged', refreshAfterSessionChange);
    return () => {
      unbindSession();
      unbindRuntime();
    };
  }, [refreshAfterSessionChange, started]);

  useEffect(() => {
    if (!isStreaming && started) refreshAfterSessionChange();
    // pi 的 run.ended 与会话文件最终落盘存在极短时序差，活动会话结束后补读一次。
  }, [isStreaming, refreshAfterSessionChange, started]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-session-menu]')) return;
      setOpenMenu(undefined);
      setConfirmDelete(undefined);
      setRenamePath(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(undefined);
        setConfirmDelete(undefined);
        setRenamePath(undefined);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const groups = useMemo(() => groupByProject(sessions), [sessions]);
  const activeGroups = groups.filter((group) => group.sessions.some((session) => !session.archived));
  const archivedGroups = groups.filter((group) => group.sessions.some((session) => session.archived));

  const openMenuAt = (key: string, x: number, y: number, estimatedHeight: number) => {
    const margin = 8;
    setOpenMenu(key);
    setConfirmDelete(undefined);
    setRenamePath(undefined);
    setMenuPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - MENU_WIDTH - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - estimatedHeight - margin)),
    });
  };

  const openMenuFromTrigger = (
    event: React.MouseEvent<HTMLButtonElement>,
    key: string,
    estimatedHeight: number,
  ) => {
    event.stopPropagation();
    if (openMenu === key) {
      setOpenMenu(undefined);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(key, rect.right + 6, rect.top, estimatedHeight);
  };

  const run = async (
    action: () => Promise<{ success: boolean; error?: string }>,
    openChatOnSuccess = false,
  ) => {
    setBusy(true);
    try {
      const result = await action();
      if (result.success) {
        if (openChatOnSuccess) onOpenChat();
        setOpenMenu(undefined);
        setConfirmDelete(undefined);
        setRenamePath(undefined);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const renderGroup = (group: ProjectGroup, archivedOnly: boolean) => {
    const visibleSessions = group.sessions.filter((session) => session.archived === archivedOnly);
    if (visibleSessions.length === 0) return null;
    const groupKey = `${archivedOnly ? 'archived' : 'active'}:${group.cwd}`;
    const isCollapsed = collapsed[groupKey] ?? (archivedOnly || group.cwd !== activeCwd);
    const menuOpen = openMenu === groupKey;
    const projectRunning = visibleSessions.some((session) => session.isRunning);
    const currentIndex = visibleSessions.findIndex((session) => session.isCurrent);
    const visibleCount = Math.max(
      visibleCounts[groupKey] ?? SESSION_PAGE_SIZE,
      currentIndex >= 0 ? currentIndex + 1 : 0,
    );
    const displayedSessions = visibleSessions.slice(0, visibleCount);
    const remainingCount = visibleSessions.length - displayedSessions.length;
    return (
      <div
        key={groupKey}
        className="session-group"
        data-testid={`${archivedOnly ? 'archived-' : ''}session-group-${group.name}`}
        onContextMenu={(event) => {
          if ((event.target as Element).closest('.sidebar-session-row')) return;
          event.preventDefault();
          openMenuAt(groupKey, event.clientX, event.clientY, PROJECT_MENU_HEIGHT);
        }}
      >
        <div className="session-group-heading">
          <button
            className="session-group-header"
            data-testid={`${archivedOnly ? 'archived-' : ''}session-group-header-${group.name}`}
            title={group.cwd}
            aria-expanded={!isCollapsed}
            onClick={() => setCollapsed((prev) => ({ ...prev, [groupKey]: !isCollapsed }))}
          >
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {archivedOnly ? <Archive size={13} /> : <Folder size={13} />}
            <span className="session-group-name">{group.name}</span>
            <span className="session-group-count">{visibleSessions.length}</span>
          </button>
          <button
            className="session-menu-trigger"
            data-testid={`${archivedOnly ? 'archived-' : ''}session-group-menu-${group.name}`}
            aria-label={t('sessions.projectMenu')}
            onClick={(event) => openMenuFromTrigger(event, groupKey, PROJECT_MENU_HEIGHT)}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && menuPosition && createPortal(
            <div
              className="session-context-menu project-context-menu"
              data-session-menu
              data-testid={`project-context-menu-${group.name}`}
              role="menu"
              style={menuPosition}
            >
              <button
                onClick={() => void run(() => hostApi.piSessions.archiveProject(group.cwd, !archivedOnly))}
                disabled={busy || projectRunning}
              >
                {archivedOnly ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                {archivedOnly ? t('sessions.unarchive') : t('sessions.archive')}
              </button>
            </div>,
            document.body,
          )}
        </div>
        {!isCollapsed && displayedSessions.map((session) => {
          const sessionKey = `session:${session.path}`;
          const sessionMenuOpen = openMenu === sessionKey;
          const deleting = confirmDelete === session.path;
          const renaming = renamePath === session.path;
          return (
            <div
              key={session.id}
              className="sidebar-session-row"
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openMenuAt(sessionKey, event.clientX, event.clientY, SESSION_MENU_HEIGHT);
              }}
            >
              <button
                data-testid={`sidebar-session-${session.id}`}
                className={session.isCurrent ? 'sidebar-session current' : 'sidebar-session'}
                title={session.path}
                onClick={() => {
                  setOpenMenu(undefined);
                  onOpenChat();
                  if (!session.isCurrent) void hostApi.piSessions.switch(session.path, session.cwd);
                }}
              >
                {session.isRunning && (
                  <span
                    className="sidebar-session-running"
                    data-testid={`sidebar-session-running-${session.id}`}
                    title={t('sessions.running')}
                    aria-label={t('sessions.running')}
                  />
                )}
                <span className="sidebar-session-title">
                  {session.name || session.firstMessage || t('sessions.untitled')}
                </span>
              </button>
              <button
                className="session-menu-trigger sidebar-session-menu-trigger"
                data-testid={`sidebar-session-menu-${session.id}`}
                aria-label={t('sessions.sessionMenu')}
                onClick={(event) => openMenuFromTrigger(event, sessionKey, SESSION_MENU_HEIGHT)}
              >
                <MoreHorizontal size={14} />
              </button>
              {sessionMenuOpen && menuPosition && createPortal(
                <div
                  className="session-context-menu session-item-context-menu"
                  data-session-menu
                  data-testid={`session-context-menu-${session.id}`}
                  role="menu"
                  style={menuPosition}
                >
                  {renaming ? (
                    <div className="sidebar-session-rename-form">
                      <input
                        data-testid={`sidebar-session-rename-input-${session.id}`}
                        value={renameValue}
                        placeholder={t('sessions.renamePlaceholder')}
                        autoFocus
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && renameValue.trim()) {
                            void run(() => hostApi.piSessions.rename(session.path, renameValue));
                          }
                          if (event.key === 'Escape') setRenamePath(undefined);
                        }}
                      />
                      <div className="sidebar-session-rename-actions">
                        <button
                          aria-label={t('sessions.save')}
                          disabled={busy || !renameValue.trim()}
                          onClick={() => void run(() => hostApi.piSessions.rename(session.path, renameValue))}
                        >
                          <Check size={14} />
                        </button>
                        <button aria-label={t('sessions.cancel')} onClick={() => setRenamePath(undefined)}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        data-testid={`sidebar-session-rename-${session.id}`}
                        onClick={() => {
                          setRenameValue(session.name || session.firstMessage || '');
                          setRenamePath(session.path);
                        }}
                        disabled={busy || session.isRunning}
                      >
                        <Pencil size={14} />
                        {t('sessions.rename')}
                      </button>
                      <button
                        data-testid={`sidebar-session-copy-id-${session.id}`}
                        onClick={() => {
                          void hostApi.app.writeClipboard(session.id);
                          setOpenMenu(undefined);
                        }}
                      >
                        <Copy size={14} />
                        {t('sessions.copyId')}
                      </button>
                      <button
                        data-testid={`sidebar-session-fork-${session.id}`}
                        onClick={() => void run(() => hostApi.piSessions.fork(session.path), true)}
                        disabled={busy || session.isRunning}
                      >
                        <GitFork size={14} />
                        {t('sessions.continueNewChat')}
                      </button>
                      <div className="session-context-separator" />
                      <button
                        onClick={() => void run(() => hostApi.piSessions.archive(session.path, !session.archived))}
                        disabled={busy || session.isRunning}
                      >
                        {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        {session.archived ? t('sessions.unarchive') : t('sessions.archive')}
                      </button>
                      {deleting ? (
                        <button
                          className="session-context-danger"
                          onClick={() => void run(() => hostApi.piSessions.remove(session.path))}
                          disabled={busy || session.isRunning}
                        >
                          <Trash2 size={14} />
                          {t('sessions.confirmDelete')}
                        </button>
                      ) : (
                        <button
                          className="session-context-danger"
                          onClick={() => setConfirmDelete(session.path)}
                          disabled={busy || session.isRunning}
                        >
                          <Trash2 size={14} />
                          {t('sessions.delete')}
                        </button>
                      )}
                    </>
                  )}
                </div>,
                document.body,
              )}
            </div>
          );
        })}
        {!isCollapsed && remainingCount > 0 && (
          <button
            className="session-show-more"
            data-testid={`${archivedOnly ? 'archived-' : ''}session-group-show-more-${group.name}`}
            onClick={() => setVisibleCounts((previous) => ({
              ...previous,
              [groupKey]: visibleCount + SESSION_PAGE_SIZE,
            }))}
          >
            {t('sessions.showMore', { count: remainingCount })}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-sessions" data-testid="sidebar-sessions">
      {started && activeGroups.map((group) => renderGroup(group, false))}
      {started && archivedGroups.length > 0 && (
        <div className="archived-sessions" data-testid="archived-sessions">
          <div className="archived-sessions-label">{t('sessions.archived')}</div>
          {archivedGroups.map((group) => renderGroup(group, true))}
        </div>
      )}
    </div>
  );
}
