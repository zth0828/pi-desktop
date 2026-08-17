import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  AppWindow,
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
import {
  consumeSessionDragCancelled,
  consumeSessionDroppedInWindow,
  isPaneDropHoverActive,
  markSessionDragCancelled,
  resetSessionDragCancelled,
  resetSessionDroppedInWindow,
  subscribePaneDropHover,
} from '../lib/session-drag';
import { sessionPathsInTree } from '../stores/panes';
import { panesStore } from '../stores/panes-default';
import { useActiveChatStore } from '../pages/Chat/chat-store-context';
import { useStore } from 'zustand';

type MenuPosition = { left: number; top: number };

const SESSION_PAGE_SIZE = 10;
const MENU_WIDTH = 196;
// 7 个菜单项（含「在独立窗口打开」）+ 分隔线的估算高度
const SESSION_MENU_HEIGHT = 280;
const PROJECT_MENU_HEIGHT = 48;

type SessionListProps = {
  onOpenChat: () => void;
};

/** 拖拽全程的全局提示浮条：窗口内分栏/替换 vs 窗口外独立窗口；悬停落区时弱化让位 */
function SessionDragHint() {
  const { t } = useTranslation();
  const paneHover = useSyncExternalStore(subscribePaneDropHover, isPaneDropHoverActive);
  return createPortal(
    <div
      className={paneHover ? 'session-drag-hint muted' : 'session-drag-hint'}
      data-testid="session-drag-hint"
    >
      {t('panes.dragHint')}
    </div>,
    document.body,
  );
}

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
  const [draggingPath, setDraggingPath] = useState<string>();
  const dragPayload = useRef<{ sessionPath: string; cwd: string } | undefined>(undefined);
  // 拖拽期间挂的 Esc keydown 监听（dragend 摘除）；Esc 取消坐标启发式接不住 mac，见 session-drag.ts
  const dragEscCleanup = useRef<(() => void) | undefined>(undefined);
  const refreshSequence = useRef(0);
  const started = useActiveChatStore((s) => s.started);
  const isStreaming = useActiveChatStore((s) => s.isStreaming);
  const activeCwd = useActiveChatStore((s) => s.cwd);
  // 分栏树中已打开的会话：行内"已打开"标记；实例绑定由 watcher 回写叶子
  const paneRoot = useStore(panesStore, (s) => s.root);
  const openSessionPaths = useMemo(() => new Set(sessionPathsInTree(paneRoot)), [paneRoot]);

  /** 侧栏普通点击：同窗口已有该会话时只激活原面板。 */
  const focusOpenSession = useCallback((sessionPath: string, cwd?: string): boolean => {
    const panes = panesStore.getState();
    if (!panes.findPaneBySession(sessionPath)) return false;
    panes.openOrFocusSession(sessionPath, cwd);
    return true;
  }, []);

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
    // 会话页的删除/归档/重命名/分叉不会触发上面两个事件，靠此事件即时同步
    const unbindChanged = onHostEvent('piRuntime', 'sessionsChanged', refreshAfterSessionChange);
    return () => {
      unbindSession();
      unbindRuntime();
      unbindChanged();
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
              className={
                draggingPath === session.path ? 'sidebar-session-row dragging' : 'sidebar-session-row'
              }
              draggable
              onDragStart={(event) => {
                // 拖出会话行；松手在 app 窗口外 → 独立窗口（落点判定在 main 侧）
                resetSessionDroppedInWindow();
                resetSessionDragCancelled();
                dragPayload.current = { sessionPath: session.path, cwd: session.cwd };
                event.dataTransfer.setData(
                  'application/x-pi-session',
                  JSON.stringify(dragPayload.current),
                );
                event.dataTransfer.effectAllowed = 'move';
                // Esc 取消：mac 上取消时 dragend 坐标是取消点而非 (0,0)，靠 keydown 标记识别
                const onEsc = (e: KeyboardEvent) => {
                  if (e.key === 'Escape') markSessionDragCancelled();
                };
                document.addEventListener('keydown', onEsc);
                dragEscCleanup.current = () => document.removeEventListener('keydown', onEsc);
                setOpenMenu(undefined);
                setDraggingPath(session.path);
                // 兜底：行组件若在拖拽中途因列表刷新卸载，React 合成 onDragEnd 可能不派发，
                // 全局提示会卡住；document 原生监听与本行 onDragEnd 幂等，先触发先生效
                const clearDragging = () => setDraggingPath(undefined);
                document.addEventListener('drop', clearDragging, { once: true, capture: true });
                document.addEventListener('dragend', clearDragging, { once: true, capture: true });
              }}
              onDragEnd={(event) => {
                setDraggingPath(undefined);
                dragEscCleanup.current?.();
                dragEscCleanup.current = undefined;
                const payload = dragPayload.current;
                dragPayload.current = undefined;
                // 分栏落区已消化本次拖拽（分栏/替换/同会话激活），不再上报 OS 开窗
                if (consumeSessionDroppedInWindow()) return;
                // Esc 取消拖拽：不上报 OS 开窗（坐标启发式在 mac 接不住，见 session-drag.ts）
                if (consumeSessionDragCancelled()) return;
                // 部分平台 Esc 取消拖拽时 dragend 坐标为 (0,0)，视为取消不上报
                if (!payload || (event.screenX === 0 && event.screenY === 0)) return;
                // 窗口内松手也会走到这里；main 侧按窗口 bounds 判定兜住（窗口内 = 不开窗）
                void hostApi.windows.openDetachedAt({
                  sessionPath: payload.sessionPath,
                  cwd: payload.cwd,
                  screenX: event.screenX,
                  screenY: event.screenY,
                });
              }}
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
                  // 先在当前窗口查面板，再查其他窗口；只有全局都未打开时
                  // 才替换当前活跃面板，避免同一会话同时出现在多个窗口。
                  if (focusOpenSession(session.path, session.cwd)) return;
                  void hostApi.windows.focusIfOpen(session.path).then((focused) => {
                    if (!focused) panesStore.getState().openOrFocusSession(session.path, session.cwd);
                  });
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
                {openSessionPaths.has(session.path) && (
                  <span
                    className="sidebar-session-open"
                    data-testid={`sidebar-session-open-${session.id}`}
                    title={t('sessions.openInPane')}
                    aria-label={t('sessions.openInPane')}
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
                        data-testid={`sidebar-session-open-detached-${session.id}`}
                        onClick={() => {
                          // 同一会话已经在当前窗口的任一面板时，只聚焦已有面板；
                          // 不再从活跃面板重复创建独立窗口。
                          if (openSessionPaths.has(session.path)) {
                            focusOpenSession(session.path, session.cwd);
                          } else {
                            void hostApi.windows.openDetached({ sessionPath: session.path, cwd: session.cwd });
                          }
                          setOpenMenu(undefined);
                        }}
                      >
                        <AppWindow size={14} />
                        {t('sessions.openDetached')}
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
      {draggingPath && <SessionDragHint />}
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
