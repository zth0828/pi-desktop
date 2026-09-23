import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Columns2,
  FileCode2,
  Files,
  Layers,
  Sparkles,
  SquareX,
  Terminal,
  X,
} from 'lucide-react';
import { hostApi } from '../../lib/host-api';
import { FileIcon } from '../../components/FileIcon';
import {
  clampPanelWidth,
  getNextModePreference,
  resolveDefaultPanelWidth,
  resolveEffectiveMode,
  PANEL_WIDTH_STORAGE_KEY,
  WORKSPACE_PANEL_MODE_KEY,
  type WorkspacePanelModePreference,
} from '../../lib/workspace-panel-mode';
import { usePaneChatStore } from './chat-store-context';
import {
  availablePanelSpace,
  getContainer,
  type WorkbenchTab,
} from './workbench/types';
import { FileExplorer } from './workbench/FilesTab';
import { FilePreview } from './workbench/FilePreviewTab';
import { CommandList } from './workbench/CommandsTab';
import { ReviewWorkspace } from './workbench/ReviewTab';

const DEFAULT_WORKSPACE_TREE_WIDTH = 240;
const MIN_WORKSPACE_TREE_WIDTH = 200;
const MAX_WORKSPACE_TREE_WIDTH = 450;
const WORKSPACE_TREE_WIDTH_STORAGE_KEY = 'pi-desktop.workspace-tree-width';

export function ReviewPanel() {
  const { t } = useTranslation();
  const reviewOpen = usePaneChatStore((s) => s.reviewOpen);
  const workspaceOpen = usePaneChatStore((s) => s.workspaceOpen);
  const setReviewOpen = usePaneChatStore((s) => s.setReviewOpen);
  const setWorkspaceOpen = usePaneChatStore((s) => s.setWorkspaceOpen);
  const workspaceFileRequest = usePaneChatStore((s) => s.workspaceFileRequest);
  const reviewFileRequest = usePaneChatStore((s) => s.reviewFileRequest);
  const workbenchTabRequest = usePaneChatStore((s) => s.workbenchTabRequest);
  const cwd = usePaneChatStore((s) => s.cwd);
  const [tab, setTab] = useState<WorkbenchTab>('files');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [userToggledInNarrow, setUserToggledInNarrow] = useState<boolean | null>(null);
  const [rootItemCount, setRootItemCount] = useState(0);
  const [workspaceTreeWidth, setWorkspaceTreeWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(WORKSPACE_TREE_WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_WORKSPACE_TREE_WIDTH && saved <= MAX_WORKSPACE_TREE_WIDTH
      ? saved
      : DEFAULT_WORKSPACE_TREE_WIDTH;
  });
  const [workspaceTreeResizing, setWorkspaceTreeResizing] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | undefined>(() => {
    const saved = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : undefined;
  });
  // 扩窗期间钉住的面板像素宽（不持久化）：窗口变宽后容器随变，不钉则默认宽公式把面板继续撑大。
  // 与 panelWidth（用户拖拽、持久化）分开；关闭或离开 docked 时清空，下次展开重新按公式算默认宽。
  const [pinnedWidth, setPinnedWidth] = useState<number | undefined>(undefined);
  const [modePreference, setModePreference] = useState<WorkspacePanelModePreference>(() => {
    const saved = window.localStorage.getItem(WORKSPACE_PANEL_MODE_KEY);
    if (saved === 'docked' || saved === 'overlay' || saved === 'auto') return saved;
    // 默认 docked：面板向右弹开与聊天列并排；仅超窄容器回退 overlay
    return 'docked';
  });
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [panelClientWidth, setPanelClientWidth] = useState<number>(0);
  const [resizing, setResizing] = useState(false);
  const [dragState, setDragState] = useState<{ startX: number; initialWidth: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = reviewOpen || workspaceOpen;

  useEffect(() => {
    setTab('files');
    setSelectedFile(null);
    setOpenFiles([]);
    setFileTreeOpen(true);
    setUserToggledInNarrow(null);
  }, [cwd]);

  useEffect(() => {
    if (reviewOpen) setTab('review');
    else if (workspaceOpen && tab === 'review') setTab('files');
  }, [reviewOpen, workspaceOpen, tab]);

  useEffect(() => {
    if (!reviewFileRequest) return;
    setTab('review');
    setUserToggledInNarrow(false);
  }, [reviewFileRequest]);

  useEffect(() => {
    if (!workspaceFileRequest) return;
    const { path } = workspaceFileRequest;
    setSelectedFile(path);
    setOpenFiles((current) => (current.includes(path) ? current : [...current, path]));
    setTab(`file:${path}`);
    setFileTreeOpen(false);
    setUserToggledInNarrow(false);
  }, [workspaceFileRequest]);

  useEffect(() => {
    if (!workbenchTabRequest) return;
    setTab(workbenchTabRequest.tab);
    setUserToggledInNarrow(false);
  }, [workbenchTabRequest]);

  useEffect(() => {
    const container = getContainer(panelRef.current);
    if (!container) return;
    setContainerWidth(container.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width || (entry.target as HTMLElement).clientWidth;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPanelClientWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width || (entry.target as HTMLElement).clientWidth;
        if (width > 0) {
          setPanelClientWidth(width);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_TREE_WIDTH_STORAGE_KEY, String(Math.round(workspaceTreeWidth)));
  }, [workspaceTreeWidth]);

  const onWorkspaceTreeResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const resizer = e.currentTarget;
    resizer.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = workspaceTreeWidth;
    let isDragging = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (!isDragging && Math.abs(deltaX) >= 2) {
        isDragging = true;
        setWorkspaceTreeResizing(true);
      }
      if (isDragging) {
        const maxAllowed = Math.min(MAX_WORKSPACE_TREE_WIDTH, Math.floor((panelClientWidth || 600) * 0.6));
        const clamped = Math.max(MIN_WORKSPACE_TREE_WIDTH, Math.min(maxAllowed, startWidth + deltaX));
        setWorkspaceTreeWidth(clamped);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (resizer.hasPointerCapture(upEvent.pointerId)) {
        resizer.releasePointerCapture(upEvent.pointerId);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setWorkspaceTreeResizing(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const effectiveContainerWidth = containerWidth || availablePanelSpace(panelRef.current);
  const effectiveMode = resolveEffectiveMode(modePreference, effectiveContainerWidth);
  const expectedPanelWidth =
    panelWidth ??
    pinnedWidth ??
    resolveDefaultPanelWidth(effectiveContainerWidth, tab === 'review' ? 'review' : 'files', effectiveMode);

  const isNarrowPanel = panelClientWidth > 0 && panelClientWidth < 480;
  const effectiveTreeOpen = isNarrowPanel ? (userToggledInNarrow ?? false) : fileTreeOpen;

  useEffect(() => {
    if (!isNarrowPanel && userToggledInNarrow !== null) {
      setUserToggledInNarrow(null);
    }
  }, [isNarrowPanel, userToggledInNarrow]);

  const toggleFileTree = useCallback(() => {
    if (isNarrowPanel) {
      setUserToggledInNarrow(!effectiveTreeOpen);
    } else {
      setFileTreeOpen(!effectiveTreeOpen);
    }
  }, [isNarrowPanel, effectiveTreeOpen]);

  const closeFileTree = useCallback(() => {
    if (isNarrowPanel) {
      setUserToggledInNarrow(false);
    } else {
      setFileTreeOpen(false);
    }
  }, [isNarrowPanel]);

  useEffect(() => {
    const container = getContainer(panelRef.current);
    if (!container) return;
    container.classList.remove('workspace-docked', 'workspace-overlay');
    if (open) {
      container.classList.add(effectiveMode === 'overlay' ? 'workspace-overlay' : 'workspace-docked');
    }
    return () => {
      container.classList.remove('workspace-docked', 'workspace-overlay');
    };
  }, [open, effectiveMode]);

  // docked 展开时把 OS 窗口向右加宽出面板宽度：聊天列保持展开前像素宽，不被挤压。
  // 关闭 / 切 overlay / 卸载时对称缩回。屏幕右缘空间不足由后端 clamp，差额仍由聊天列让出。
  useEffect(() => {
    if (!open || effectiveMode !== 'docked') return;
    const currentWidth = Math.round(panelRef.current?.clientWidth ?? expectedPanelWidth);
    if (currentWidth <= 0) return;
    setPinnedWidth(currentWidth);
    void hostApi.windows.expandRight({ extraWidth: currentWidth });
    return () => {
      setPinnedWidth(undefined);
      void hostApi.windows.restoreExpandRight();
    };
    // 仅在打开/模式切换时触发；面板宽度变化（拖拽）不重复扩窗
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveMode]);

  useEffect(() => {
    if (!dragState) return;
    const { startX, initialWidth } = dragState;
    let isDragging = false;

    const onPointerMove = (event: PointerEvent) => {
      const deltaX = startX - event.clientX;
      if (!isDragging && Math.abs(deltaX) >= 3) {
        isDragging = true;
        setResizing(true);
      }
      if (isDragging) {
        setPanelWidth(clampPanelWidth(initialWidth + deltaX, effectiveContainerWidth, effectiveMode));
      }
    };

    const onPointerUp = () => {
      setDragState(null);
      setResizing(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragState, effectiveContainerWidth, effectiveMode]);

  useEffect(() => {
    if (panelWidth) window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(panelWidth)));
  }, [panelWidth]);

  const close = useCallback(() => {
    setReviewOpen(false);
    setWorkspaceOpen(false);
  }, [setReviewOpen, setWorkspaceOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        document.querySelector(
          '.image-lightbox, .extui-overlay, .extui-dock, .plan-install-overlay, .session-search-overlay, .tree-overlay, .skill-view-overlay',
        )
      )
        return;
      if (effectiveTreeOpen) {
        closeFileTree();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (effectiveMode === 'overlay') {
        close();
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [effectiveTreeOpen, closeFileTree, effectiveMode, close]);

  const chooseFile = (path: string) => {
    setSelectedFile(path);
    setOpenFiles((current) => (current.includes(path) ? current : [...current, path]));
    setTab(`file:${path}`);
    setFileTreeOpen(false);
    setUserToggledInNarrow(false);
  };

  const closeFile = (path: string, e?: MouseEvent) => {
    e?.stopPropagation();
    const index = openFiles.indexOf(path);
    const remaining = openFiles.filter((item) => item !== path);
    setOpenFiles(remaining);
    if (tab === `file:${path}`) {
      const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
      setSelectedFile(next ?? null);
      setTab(next ? `file:${next}` : 'files');
    }
  };

  const closeAllFiles = () => {
    setOpenFiles([]);
    setSelectedFile(null);
    if (tab.startsWith('file:')) setTab('files');
  };

  const cycleMode = useCallback(() => {
    setModePreference((current) => {
      const next = getNextModePreference(current);
      window.localStorage.setItem(WORKSPACE_PANEL_MODE_KEY, next);
      return next;
    });
  }, []);

  const fileTab = tab.startsWith('file:') ? tab.slice(5) : null;
  const activeFile = fileTab ?? selectedFile;
  const titleFor = (path: string) => path.split('/').pop() ?? path;

  if (!open) return null;

  return (
    <>
      {effectiveMode === 'overlay' && (
        <button
          className="workspace-panel-backdrop"
          data-testid="workspace-backdrop"
          aria-label={t('workspace.close')}
          onClick={close}
          tabIndex={-1}
        />
      )}
      <aside
        ref={panelRef}
        className={`workspace-panel ${effectiveMode}${tab === 'review' ? ' review-active' : ''}${resizing ? ' resizing' : ''}`}
        data-testid="review-panel"
        data-mode={effectiveMode}
        data-mode-preference={modePreference}
        style={
          {
            '--workspace-panel-width': `${Math.round(expectedPanelWidth)}px`,
            '--workspace-tree-width': `${workspaceTreeWidth}px`,
          } as CSSProperties
        }
      >
        <div
          className="workspace-resize-handle"
          data-testid="workspace-resize-handle"
          role="separator"
          aria-label={t('workspace.resize')}
          aria-orientation="vertical"
          tabIndex={0}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cycleMode();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentWidth = panelRef.current?.clientWidth ?? expectedPanelWidth;
            setDragState({ startX: event.clientX, initialWidth: currentWidth });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const delta = event.key === 'ArrowLeft' ? 24 : -24;
            setPanelWidth(clampPanelWidth(expectedPanelWidth + delta, effectiveContainerWidth, effectiveMode));
          }}
        />
        <div className="workspace-tabs">
          <div className="workspace-tabs-scroll" role="tablist">
            <button
              className={`workspace-tab${tab === 'files' ? ' active' : ''}`}
              role="tab"
              aria-selected={tab === 'files'}
              data-testid="workspace-files-tab"
              onClick={() => {
                setWorkspaceOpen(true);
                setTab('files');
                setFileTreeOpen(true);
                setUserToggledInNarrow(null);
              }}
            >
              <Files size={14} />
              {t('workspace.files')}
            </button>
            {openFiles.map((path) => (
              <div
                className={`workspace-file-tab${tab === `file:${path}` ? ' active' : ''}`}
                data-testid="workspace-file-tab"
                key={path}
                title={path}
              >
                <FileIcon name={path} size={14} />
                <button
                  className="workspace-file-tab-main"
                  role="tab"
                  aria-selected={tab === `file:${path}`}
                  onClick={() => {
                    setWorkspaceOpen(true);
                    setSelectedFile(path);
                    setTab(`file:${path}`);
                  }}
                >
                  {titleFor(path)}
                </button>
                <button
                  className="workspace-file-tab-close"
                  aria-label={t('workspace.closeFile', { name: titleFor(path) })}
                  onClick={(e) => closeFile(path, e)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              className={`workspace-tab${tab === 'review' ? ' active' : ''}`}
              role="tab"
              aria-selected={tab === 'review'}
              data-testid="workspace-review-tab"
              onClick={() => {
                setReviewOpen(true);
                setTab('review');
              }}
            >
              <FileCode2 size={14} />
              {t('review.title')}
            </button>
            <button
              className={`workspace-tab${tab === 'commands' ? ' active' : ''}`}
              role="tab"
              aria-selected={tab === 'commands'}
              data-testid="workspace-commands-tab"
              onClick={() => {
                setWorkspaceOpen(true);
                setTab('commands');
              }}
            >
              <Terminal size={14} />
              {t('workspace.commands')}
            </button>
          </div>
          <div className="workspace-tab-actions">
            {tab !== 'review' && tab !== 'commands' && (
              <button
                className={`workspace-tree-trigger${effectiveTreeOpen ? ' active' : ''}`}
                data-testid="workspace-tree-toggle"
                aria-expanded={effectiveTreeOpen}
                title={effectiveTreeOpen ? t('workspace.hideFiles') : t('workspace.showFiles')}
                onClick={toggleFileTree}
              >
                <Files size={15} />
                {rootItemCount > 0 && (
                  <span aria-label={t('workspace.itemCount', { count: rootItemCount })}>{rootItemCount}</span>
                )}
              </button>
            )}
            {openFiles.length > 0 && (
              <button
                className="icon-button"
                data-testid="workspace-close-all"
                title={t('workspace.closeAll')}
                aria-label={t('workspace.closeAll')}
                onClick={closeAllFiles}
              >
                <SquareX size={16} />
              </button>
            )}
            <button
              className="icon-button"
              data-testid="workspace-mode-toggle"
              title={t(`workspace.mode.${modePreference}`)}
              aria-label={t(`workspace.mode.${modePreference}`)}
              onClick={cycleMode}
            >
              {modePreference === 'auto' ? (
                <Sparkles size={15} />
              ) : modePreference === 'docked' ? (
                <Columns2 size={15} />
              ) : (
                <Layers size={15} />
              )}
            </button>
            <button
              className="icon-button"
              data-testid="workspace-close"
              title={t('workspace.close')}
              aria-label={t('workspace.close')}
              onClick={close}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {tab === 'review' ? (
          <ReviewWorkspace />
        ) : tab === 'commands' ? (
          <CommandList />
        ) : (
          <div
            className={`workspace-browser${effectiveTreeOpen ? ' tree-open' : ''}${workspaceTreeResizing ? ' tree-resizing' : ''}`}
          >
            {effectiveTreeOpen && (
              <button
                className="workspace-tree-backdrop"
                aria-label={t('workspace.hideFiles')}
                onClick={closeFileTree}
              />
            )}
            <FileExplorer selected={activeFile} onSelect={chooseFile} onRootCount={setRootItemCount} />
            {effectiveTreeOpen && (
              <div
                className="workspace-tree-resizer"
                data-testid="workspace-tree-resizer"
                role="separator"
                aria-label={t('workspace.resizeTree')}
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={onWorkspaceTreeResizeStart}
                onDoubleClick={() => setWorkspaceTreeWidth(DEFAULT_WORKSPACE_TREE_WIDTH)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.key === 'ArrowLeft' ? -16 : 16;
                  const maxAllowed = Math.min(MAX_WORKSPACE_TREE_WIDTH, Math.floor((panelClientWidth || 600) * 0.6));
                  setWorkspaceTreeWidth((w) => Math.max(MIN_WORKSPACE_TREE_WIDTH, Math.min(maxAllowed, w + delta)));
                }}
              />
            )}
            <main className="workspace-preview" data-testid="workspace-preview">
              {activeFile ? (
                <FilePreview path={activeFile} onClose={close} />
              ) : (
                <div className="workspace-empty">{t('workspace.selectFile')}</div>
              )}
            </main>
          </div>
        )}
      </aside>
    </>
  );
}
