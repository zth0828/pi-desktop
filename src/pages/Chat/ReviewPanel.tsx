import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  AppWindow,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  FolderOpen,
  Layers,
  List,
  LoaderCircle,
  MapPin,
  PanelRightClose,
  RefreshCw,
  Search,
  Sparkles,
  SquareX,
  WrapText,
  X,
} from 'lucide-react';
import type {
  ReviewFileEntry,
  ReviewSummaryResult,
  ShellApplication,
  WorkspaceEntry,
  WorkspaceReadResult,
} from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import {
  buildHunkPatch,
  buildSplitDiffRows,
  collectFallbackFiles,
  hunkLineKind,
  mergeReviewFiles,
  parseUnifiedDiff,
  sessionChangeFiles,
  type ParsedFileDiff,
} from '../../lib/review-diff';
import { parseDiffLines } from '../../lib/tool-display';
import {
  clampPanelWidth,
  getNextModePreference,
  resolveEffectiveMode,
  DEFAULT_PANEL_WIDTH_FILES,
  DEFAULT_PANEL_WIDTH_REVIEW,
  PANEL_WIDTH_STORAGE_KEY,
  WORKSPACE_PANEL_MODE_KEY,
  type WorkspacePanelEffectiveMode,
  type WorkspacePanelModePreference,
} from '../../lib/workspace-panel-mode';
import { usePaneChatStore, usePaneHostApi } from './chat-store-context';
import { FilePreviewContent } from './FilePreviewContent';

type PendingRevert =
  | { kind: 'file'; path: string }
  | { kind: 'hunk'; path: string; patch: string };
type WorkbenchTab = 'files' | 'review' | `file:${string}`;

function getContainer(panelEl: HTMLElement | null): HTMLElement | null {
  return panelEl?.closest<HTMLElement>('.chat-page') ?? document.querySelector<HTMLElement>('.chat-page');
}

function availablePanelSpace(panelEl?: HTMLElement | null): number {
  return getContainer(panelEl ?? null)?.clientWidth ?? window.innerWidth;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const APPLICATION_PRIORITY = [
  /^cursor$/i,
  /^finder$/i,
  /^terminal$/i,
  /^ghostty$/i,
  /^visual studio code$/i,
  /^xcode$/i,
  /^android studio$/i,
  /^zed$/i,
  /sublime text/i,
  /^textedit$/i,
];

function rankApplications(applications: ShellApplication[]): ShellApplication[] {
  const priority = (name: string) => {
    const index = APPLICATION_PRIORITY.findIndex((pattern) => pattern.test(name));
    return index < 0 ? APPLICATION_PRIORITY.length : index;
  };
  return [...applications].sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name));
}

function WorkspaceFileIcon({ name, size = 14 }: { name: string; size?: number }) {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (['js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'rb', 'go', 'rs', 'java', 'swift', 'sh'].includes(extension)) return <FileCode2 size={size} />;
  if (['json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'plist'].includes(extension)) return <FileJson size={size} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'].includes(extension)) return <FileImage size={size} />;
  if (['csv', 'tsv', 'xls', 'xlsx', 'numbers'].includes(extension)) return <FileSpreadsheet size={size} />;
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar'].includes(extension)) return <FileArchive size={size} />;
  if (['md', 'markdown', 'txt', 'log', 'pdf', 'doc', 'docx', 'rtf'].includes(extension)) return <FileText size={size} />;
  return <File size={size} />;
}

function UnifiedDiff({ parsed, onRevert }: { parsed: ParsedFileDiff; onRevert?: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="review-diff" data-testid="review-diff">
      {parsed.hunks.map((hunk, index) => (
        <div className="review-hunk" key={index}>
          <div className="review-hunk-header"><span className="review-hunk-range">{hunk.header}</span>{onRevert && <button className="review-revert-btn" data-testid="revert-hunk" onClick={() => onRevert(index)}>{t('review.revertHunk')}</button>}</div>
        <pre className="diff-view review-unified" data-testid="diff-unified">
          {hunk.lines.map((line, lineIndex) => {
            const kind = hunkLineKind(line);
            return (
              <div key={lineIndex} className={`diff-line diff-${kind}`}>
                <span className="diff-sign">{kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}</span>
                <span className="diff-content">{kind === 'marker' ? line : line.slice(1)}</span>
              </div>
            );
          })}
        </pre></div>
      ))}
    </div>
  );
}

function SplitDiff({ parsed, onRevert }: { parsed: ParsedFileDiff; onRevert?: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="review-diff review-split" data-testid="review-diff">
      {parsed.hunks.map((hunk, index) => (
        <div className="split-hunk" key={index} data-testid="diff-split">
          <div className="split-hunk-header"><span>{hunk.header}</span>{onRevert && <button className="review-revert-btn" data-testid="revert-hunk" onClick={() => onRevert(index)}>{t('review.revertHunk')}</button>}</div>
          {buildSplitDiffRows(hunk).map((row, rowIndex) => (
            <div className="split-row" key={rowIndex}>
              {[row.old, row.next].map((cell, side) => (
                <div className={`split-cell diff-${cell.kind}`} key={side}>
                  <span className="split-line-number">{cell.lineNumber ?? ''}</span>
                  <code>{cell.content}</code>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FileExplorer({ selected, onSelect, onRootCount }: { selected: string | null; onSelect: (path: string) => void; onRootCount: (count: number) => void }) {
  const { t } = useTranslation();
  const cwd = usePaneChatStore((state) => state.cwd);
  const [children, setChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const loadedRef = useRef(new Set<string>());
  const loadingRef = useRef(new Set<string>());
  const generationRef = useRef(0);

  const load = useCallback(async (dir: string) => {
    if (loadedRef.current.has(dir) || loadingRef.current.has(dir)) return;
    const generation = generationRef.current;
    loadingRef.current.add(dir);
    setLoading(new Set(loadingRef.current));
    const result = await hostApi.workspace.listChildren(dir).catch(() => null);
    if (generation !== generationRef.current) return;
    loadingRef.current.delete(dir);
    setLoading(new Set(loadingRef.current));
    if (!result) return;
    loadedRef.current.add(dir);
    setChildren((current) => ({ ...current, [dir]: result.entries }));
    if (dir === '') onRootCount(result.entries.length);
  }, [onRootCount]);

  useEffect(() => {
    generationRef.current += 1;
    loadedRef.current.clear();
    loadingRef.current.clear();
    setChildren({});
    setExpanded(new Set(['']));
    setLoading(new Set());
    setFilter('');
    onRootCount(0);
    void load('');
  }, [cwd, load, onRootCount]);

  const toggle = (entry: WorkspaceEntry) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!loadedRef.current.has(entry.path)) void load(entry.path);
  };

  const renderEntries = (dir: string, depth: number): React.ReactNode =>
    (children[dir] ?? []).map((entry) => {
      const open = expanded.has(entry.path);
      const matches = !filter || entry.path.toLowerCase().includes(filter.toLowerCase());
      if (filter && entry.kind === 'file' && !matches) return null;
      return (
        <div key={entry.path}>
          <button
            className={`workspace-tree-row${selected === entry.path ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            data-testid={entry.kind === 'file' ? 'workspace-file' : 'workspace-directory'}
            title={entry.path}
            onClick={() => entry.kind === 'directory' ? toggle(entry) : onSelect(entry.path)}
          >
            {entry.kind === 'directory' ? (
              <>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? <FolderOpen size={14} /> : <Folder size={14} />}</>
            ) : <><span className="workspace-tree-indent" /><WorkspaceFileIcon name={entry.name} /></>}
            <span>{entry.name}</span>
          </button>
          {entry.kind === 'directory' && open && renderEntries(entry.path, depth + 1)}
          {entry.kind === 'directory' && open && loading.has(entry.path) && (
            <div className="workspace-tree-loading" style={{ paddingLeft: 29 + (depth + 1) * 14 }}><LoaderCircle size={13} />{t('workspace.loadingFolder')}</div>
          )}
        </div>
      );
    });

  return (
    <aside className="workspace-tree" data-testid="workspace-tree">
      <label className="workspace-filter">
        <Search size={14} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('workspace.filter')} />
      </label>
      <div className="workspace-tree-scroll">
        {loading.has('') && <div className="workspace-tree-loading"><LoaderCircle size={13} />{t('workspace.loadingFolder')}</div>}
        {renderEntries('', 0)}
      </div>
    </aside>
  );
}

function OpenWithMenu({ absolutePath }: { absolutePath: string }) {
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
      <button className="workspace-open-trigger" data-testid="workspace-open-with" aria-expanded={open} onClick={() => void toggle()}>
        <AppWindow size={14} />
        <span>{t('workspace.openWith')}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="workspace-open-popover" data-testid="workspace-open-menu">
          <button onClick={() => { setOpen(false); void hostApi.shell.showInFolder(absolutePath); }}>
            <MapPin size={15} /><span>{t('workspace.showInFolder')}</span>
          </button>
          <button onClick={() => { setOpen(false); void hostApi.shell.openPath(absolutePath); }}>
            <AppWindow size={15} /><span>{t('workspace.defaultApplication')}</span>
          </button>
          <div className="workspace-open-separator" />
          {loading && <div className="workspace-open-state">{t('workspace.findingApps')}</div>}
          {!loading && applications.map((application) => (
            <button key={application.id} data-testid="workspace-open-application" onClick={() => void openApplication(application)}>
              {application.iconDataUrl
                ? <img className="workspace-application-icon" src={application.iconDataUrl} alt="" />
                : <AppWindow size={15} />}
              <span>{application.name}</span>
            </button>
          ))}
          {!loading && applications.length === 0 && <div className="workspace-open-state">{t('workspace.noApps')}</div>}
        </div>
      )}
      {error && <div className="workspace-open-error" role="status">{error}</div>}
    </div>
  );
}

function FilePreview({ path }: { path: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<WorkspaceReadResult | null>(null);
  const [error, setError] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    setWrapLines(true);
    void hostApi.workspace.readFile(path)
      .then((next) => { if (!cancelled) setResult(next); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [path]);
  if (error) return <div className="workspace-empty">{t('workspace.readFailed')}</div>;
  if (!result) return <div className="workspace-empty">{t('workspace.loading')}</div>;
  return (
    <div className="workspace-file-view">
      <header className="workspace-file-header">
        <div className="workspace-file-title">
          <WorkspaceFileIcon name={result.name} size={15} />
          <span title={result.path}>{result.name}</span>
          <small>{formatBytes(result.size)}</small>
        </div>
        <div className="workspace-file-actions">
          {(result.kind === 'text' || result.kind === 'markdown') && (
            <button className={`icon-button${wrapLines ? ' active' : ''}`} data-testid="workspace-toggle-wrap" aria-pressed={wrapLines} title={wrapLines ? t('workspace.disableWrap') : t('workspace.enableWrap')} onClick={() => setWrapLines((current) => !current)}><WrapText size={15} /></button>
          )}
          <OpenWithMenu absolutePath={result.absolutePath} />
        </div>
      </header>
      <div className="workspace-file-content"><FilePreviewContent result={result} wrapLines={wrapLines} /></div>
    </div>
  );
}

type SelectedReviewItem = {
  group: 'session' | 'workspace';
  path: string;
};

function ReviewWorkspace() {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const cwd = usePaneChatStore((s) => s.cwd);
  const [summary, setSummary] = useState<ReviewSummaryResult | null>(null);
  const [selected, setSelected] = useState<SelectedReviewItem | null>(null);
  const [diff, setDiff] = useState<ParsedFileDiff | null>(null);
  const [toolDiff, setToolDiff] = useState<string | null>(null);
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const [showFiles, setShowFiles] = useState(true);
  const [sessionOpen, setSessionOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  const sessionFiles = useMemo(() => sessionChangeFiles(toolExecutions, cwd), [toolExecutions, cwd]);
  const toolFiles = useMemo(() => collectFallbackFiles(toolExecutions), [toolExecutions]);
  const workspaceFiles = useMemo(() => mergeReviewFiles(
    cwd,
    Boolean(summary?.available),
    summary?.available ? summary.files : [],
    toolFiles,
  ), [cwd, summary, toolFiles]);

  const toolFileFor = useCallback((filePath: string) => {
    const root = cwd?.replace(/\\/g, '/').replace(/\/$/, '');
    return toolFiles.find((file) => {
      const normalized = file.path.replace(/\\/g, '/');
      const displayPath = root && normalized.startsWith(`${root}/`)
        ? normalized.slice(root.length + 1)
        : normalized;
      return displayPath === filePath;
    });
  }, [cwd, toolFiles]);

  const isBaselineFile = useCallback(
    (filePath: string) => Boolean(summary?.available && summary.files.some((file) => file.path === filePath)),
    [summary],
  );

  const refreshSummary = useCallback(async () => {
    const next = await paneApi.review.getSummary().catch(() => null);
    setSummary(next);
    return next;
  }, [paneApi]);

  const loadDiff = useCallback(async (item: SelectedReviewItem) => {
    if (item.group === 'session') {
      const sessionFile = sessionFiles.find((f) => f.path === item.path);
      setDiff(null);
      setToolDiff(sessionFile?.diff ?? null);
      return;
    }
    if (summary?.available && summary.files.some((file) => file.path === item.path)) {
      const result = await paneApi.review.getFileDiff(item.path).catch(() => null);
      setDiff(result?.available && result.diff ? parseUnifiedDiff(result.diff) : null);
      setToolDiff(null);
    } else {
      const fallback = toolFileFor(item.path);
      setDiff(null);
      setToolDiff(fallback?.diff ?? null);
    }
  }, [sessionFiles, summary, paneApi, toolFileFor]);

  useEffect(() => { void refreshSummary(); }, [refreshSummary]);

  useEffect(() => {
    if (sessionFiles.length === 0 && workspaceFiles.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((current) => {
      if (current) {
        if (current.group === 'session' && sessionFiles.some((f) => f.path === current.path)) {
          return current;
        }
        if (current.group === 'workspace' && workspaceFiles.some((f) => f.path === current.path)) {
          return current;
        }
      }
      if (sessionFiles.length > 0) {
        return { group: 'session', path: sessionFiles[0].path };
      }
      if (workspaceFiles.length > 0) {
        return { group: 'workspace', path: workspaceFiles[0].path };
      }
      return null;
    });
  }, [sessionFiles, workspaceFiles]);

  useEffect(() => {
    if (selected) {
      void loadDiff(selected);
    } else {
      setDiff(null);
      setToolDiff(null);
    }
  }, [selected, loadDiff]);

  const confirmRevert = async () => {
    if (!pendingRevert) return;
    const target = pendingRevert;
    setPendingRevert(null);
    const result = target.kind === 'file'
      ? await paneApi.review.revertFile(target.path)
      : await paneApi.review.revertHunk(target.path, target.patch);
    if (!result.success) {
      setRevertError(result.error ?? 'unknown');
      return;
    }
    setRevertError(null);
    await refreshSummary();
    if (selected) await loadDiff(selected);
  };

  const selectedIsBaseline = selected?.group === 'workspace' && isBaselineFile(selected.path);
  const selectedWorkspaceFile = selected?.group === 'workspace'
    ? workspaceFiles.find((file) => file.path === selected.path)
    : undefined;
  const canRevertSelected = Boolean(selectedIsBaseline && selectedWorkspaceFile?.status !== 'conflicted');
  const selectedSessionFile = selected?.group === 'session'
    ? sessionFiles.find((file) => file.path === selected.path)
    : undefined;

  return (
    <div className="review-workspace">
      <div className="review-toolbar">
        <button className="icon-button" data-testid="review-refresh" title={t('review.refresh')} onClick={() => { void refreshSummary(); if (selected) void loadDiff(selected); }}><RefreshCw size={15} /></button>
        <span className="spacer" />
        <button className="icon-button" data-testid="review-toggle-mode" title={mode === 'split' ? t('review.unified') : t('review.split')} onClick={() => setMode((current) => current === 'split' ? 'unified' : 'split')}>{mode === 'split' ? <List size={15} /> : <Columns2 size={15} />}</button>
        <button className={`icon-button${showFiles ? ' active' : ''}`} data-testid="review-toggle-files" title={showFiles ? t('review.hideFiles') : t('review.showFiles')} onClick={() => setShowFiles((current) => !current)}><Files size={15} /></button>
      </div>
      {revertError && <div className="review-error" data-testid="review-error">{t('review.revertFailed', { error: revertError })}</div>}
      <div className="review-body">
        {showFiles && (
          <div className="review-file-list" data-testid="review-file-list">
            {sessionFiles.length === 0 && workspaceFiles.length === 0 && (
              <div className="review-empty">{t('review.empty')}</div>
            )}
            {sessionFiles.length > 0 && (
              <div className="review-group" data-testid="review-group-session">
                <button
                  className="review-group-header"
                  data-testid="review-group-session-toggle"
                  onClick={() => setSessionOpen((v) => !v)}
                >
                  {sessionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="review-group-title">{t('review.sessionChanges')}</span>
                  <span className="review-group-count">{sessionFiles.length}</span>
                </button>
                {sessionOpen && sessionFiles.map((file) => (
                  <div
                    className={`review-file${selected?.group === 'session' && selected.path === file.path ? ' selected' : ''}`}
                    data-testid="review-file"
                    key={`session:${file.path}`}
                  >
                    <button
                      className="review-file-main"
                      onClick={() => setSelected({ group: 'session', path: file.path })}
                    >
                      <span className="review-file-name" title={file.path}>{file.path}</span>
                      <span className="review-file-status" data-testid="review-file-scope">{t('review.sessionScope')}</span>
                      <span className="review-file-stats">
                        <span className="review-stat-add">+{file.added}</span>
                        <span className="review-stat-del">-{file.deleted}</span>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {workspaceFiles.length > 0 && (
              <div className="review-group" data-testid="review-group-workspace">
                <button
                  className="review-group-header"
                  data-testid="review-group-workspace-toggle"
                  onClick={() => setWorkspaceOpen((v) => !v)}
                >
                  {workspaceOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="review-group-title">{t('review.workspaceChanges')}</span>
                  <span className="review-group-count">{workspaceFiles.length}</span>
                </button>
                {workspaceOpen && workspaceFiles.map((file) => {
                  const baselineFile = isBaselineFile(file.path);
                  return (
                    <div
                      className={`review-file${selected?.group === 'workspace' && selected.path === file.path ? ' selected' : ''}`}
                      data-testid="review-file"
                      key={`workspace:${file.path}`}
                    >
                      <button
                        className="review-file-main"
                        onClick={() => setSelected({ group: 'workspace', path: file.path })}
                      >
                        <span className="review-file-name" title={file.path}>{file.path}</span>
                        {!baselineFile && <span className="review-file-status" data-testid="review-file-status">{t('review.readOnly')}</span>}
                        {file.status === 'conflicted' && <span className="review-file-status status-conflicted" data-testid="review-file-status">{t('review.status.conflicted')}</span>}
                        <span className="review-file-stats">
                          <span className="review-stat-add">+{file.added}</span>
                          <span className="review-stat-del">-{file.deleted}</span>
                        </span>
                      </button>
                      {baselineFile && file.status !== 'conflicted' && (
                        <button
                          className="review-revert-btn"
                          data-testid="revert-file"
                          onClick={() => setPendingRevert({ kind: 'file', path: file.path })}
                        >
                          {t('review.revertFile')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="review-diff-pane">
          {selected && diff && (
            <>
              <div className="review-file-heading">
                <FileCode2 size={15} />
                <span>{selected.path}</span>
                <span className="review-file-status">{t('review.workspaceScope')}</span>
              </div>
              {mode === 'split'
                ? <SplitDiff parsed={diff} onRevert={canRevertSelected ? (index) => setPendingRevert({ kind: 'hunk', path: selected.path, patch: buildHunkPatch(diff, index) }) : undefined} />
                : <UnifiedDiff parsed={diff} onRevert={canRevertSelected ? (index) => setPendingRevert({ kind: 'hunk', path: selected.path, patch: buildHunkPatch(diff, index) }) : undefined} />}
            </>
          )}
          {selected && toolDiff && (
            <>
              <div className="review-file-heading">
                <FileCode2 size={15} />
                <span>{selected.path}</span>
                <span className="review-file-status">{t('review.sessionScope')}</span>
                {selectedSessionFile && selectedSessionFile.editCount > 1 && (
                  <span className="review-file-status">
                    {t('review.editCount', { count: selectedSessionFile.editCount })}
                  </span>
                )}
              </div>
              <pre className="diff-view review-tool-diff" data-testid="review-tool-diff">
                {parseDiffLines(toolDiff).map((line, index) => (
                  <div key={index} className={`diff-line diff-${line.kind}`}>
                    <span className="diff-linenum">{line.lineNum}</span>
                    <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
                    <span className="diff-content">{line.content}</span>
                  </div>
                ))}
              </pre>
            </>
          )}
          {selected && !diff && !toolDiff && <div className="review-empty">{t('review.noDiff', { path: selected.path })}</div>}
          {!selected && <div className="review-empty">{t('review.empty')}</div>}
        </div>
      </div>
      {pendingRevert && (
        <div className="review-confirm-overlay" data-testid="review-confirm">
          <div className="review-confirm">
            <div className="review-confirm-text">{pendingRevert.kind === 'file' ? t('review.confirmFile', { path: pendingRevert.path }) : t('review.confirmHunk', { path: pendingRevert.path })}</div>
            <div className="review-confirm-actions"><button className="chat-toolbar-btn" onClick={() => setPendingRevert(null)}>{t('review.cancel')}</button><button className="chat-toolbar-btn review-confirm-danger" data-testid="review-confirm-ok" onClick={() => void confirmRevert()}>{t('review.confirm')}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewPanel() {
  const { t } = useTranslation();
  const reviewOpen = usePaneChatStore((s) => s.reviewOpen);
  const workspaceOpen = usePaneChatStore((s) => s.workspaceOpen);
  const setReviewOpen = usePaneChatStore((s) => s.setReviewOpen);
  const setWorkspaceOpen = usePaneChatStore((s) => s.setWorkspaceOpen);
  const workspaceFileRequest = usePaneChatStore((s) => s.workspaceFileRequest);
  const cwd = usePaneChatStore((s) => s.cwd);
  const [tab, setTab] = useState<WorkbenchTab>('files');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [rootItemCount, setRootItemCount] = useState(0);
  const [panelWidth, setPanelWidth] = useState<number | undefined>(() => {
    const saved = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : undefined;
  });
  const [modePreference, setModePreference] = useState<WorkspacePanelModePreference>(() => {
    const saved = window.localStorage.getItem(WORKSPACE_PANEL_MODE_KEY);
    if (saved === 'docked' || saved === 'overlay' || saved === 'auto') return saved;
    return 'auto';
  });
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [resizing, setResizing] = useState(false);
  const [dragState, setDragState] = useState<{ startX: number; initialWidth: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = reviewOpen || workspaceOpen;

  useEffect(() => {
    setTab('files');
    setSelectedFile(null);
    setOpenFiles([]);
    setFileTreeOpen(true);
  }, [cwd]);

  useEffect(() => {
    if (reviewOpen) setTab('review');
    else if (workspaceOpen && tab === 'review') setTab('files');
  }, [reviewOpen, workspaceOpen, tab]);

  useEffect(() => {
    if (!workspaceFileRequest) return;
    const { path } = workspaceFileRequest;
    setSelectedFile(path);
    setOpenFiles((current) => (current.includes(path) ? current : [...current, path]));
    setTab(`file:${path}`);
    setFileTreeOpen(false);
  }, [workspaceFileRequest]);

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

  const effectiveContainerWidth = containerWidth || availablePanelSpace(panelRef.current);
  const expectedPanelWidth = panelWidth ?? (tab === 'review' ? DEFAULT_PANEL_WIDTH_REVIEW : DEFAULT_PANEL_WIDTH_FILES);
  const effectiveMode = resolveEffectiveMode(modePreference, effectiveContainerWidth, expectedPanelWidth);

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

  useEffect(() => {
    if (panelWidth !== undefined) {
      const clamped = clampPanelWidth(panelWidth, effectiveContainerWidth, effectiveMode);
      if (clamped !== panelWidth) {
        setPanelWidth(clamped);
      }
    }
  }, [effectiveContainerWidth, effectiveMode]);

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
      if (document.querySelector('.image-lightbox, .extui-overlay, .session-search-overlay, .tree-overlay, .skill-view-overlay')) return;
      if (fileTreeOpen) {
        setFileTreeOpen(false);
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
  }, [fileTreeOpen, effectiveMode, close]);

  const chooseFile = (path: string) => {
    setSelectedFile(path);
    setOpenFiles((current) => current.includes(path) ? current : [...current, path]);
    setTab(`file:${path}`);
    setFileTreeOpen(false);
  };
  const closeFile = (path: string) => {
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
        style={panelWidth ? { '--workspace-panel-width': `${panelWidth}px` } as CSSProperties : undefined}
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
            const currentWidth = panelRef.current?.clientWidth ?? panelWidth ?? (tab === 'review' ? DEFAULT_PANEL_WIDTH_REVIEW : DEFAULT_PANEL_WIDTH_FILES);
            setDragState({ startX: event.clientX, initialWidth: currentWidth });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const current = panelWidth ?? (tab === 'review' ? DEFAULT_PANEL_WIDTH_REVIEW : DEFAULT_PANEL_WIDTH_FILES);
            const delta = event.key === 'ArrowLeft' ? 24 : -24;
            setPanelWidth(clampPanelWidth(current + delta, effectiveContainerWidth, effectiveMode));
          }}
        />
        <div className="workspace-tabs">
          <div className="workspace-tabs-scroll" role="tablist">
            <button className={`workspace-tab${tab === 'files' ? ' active' : ''}`} role="tab" aria-selected={tab === 'files'} data-testid="workspace-files-tab" onClick={() => { setWorkspaceOpen(true); setTab('files'); setFileTreeOpen(true); }}><Files size={14} />{t('workspace.files')}</button>
            {openFiles.map((path) => (
              <div className={`workspace-file-tab${tab === `file:${path}` ? ' active' : ''}`} data-testid="workspace-file-tab" key={path} title={path}>
                <button className="workspace-file-tab-main" role="tab" aria-selected={tab === `file:${path}`} onClick={() => { setWorkspaceOpen(true); setSelectedFile(path); setTab(`file:${path}`); }}>{titleFor(path)}</button>
                <button className="workspace-file-tab-close" aria-label={t('workspace.closeFile', { name: titleFor(path) })} onClick={() => closeFile(path)}><X size={12} /></button>
              </div>
            ))}
            <button className={`workspace-tab${tab === 'review' ? ' active' : ''}`} role="tab" aria-selected={tab === 'review'} data-testid="workspace-review-tab" onClick={() => { setReviewOpen(true); setTab('review'); }}><FileCode2 size={14} />{t('review.title')}</button>
          </div>
          <div className="workspace-tab-actions">
            {tab !== 'review' && (
              <button className={`workspace-tree-trigger${fileTreeOpen ? ' active' : ''}`} data-testid="workspace-tree-toggle" aria-expanded={fileTreeOpen} title={fileTreeOpen ? t('workspace.hideFiles') : t('workspace.showFiles')} onClick={() => setFileTreeOpen((current) => !current)}>
                <Files size={15} />
                {rootItemCount > 0 && <span aria-label={t('workspace.itemCount', { count: rootItemCount })}>{rootItemCount}</span>}
              </button>
            )}
            {openFiles.length > 0 && <button className="icon-button" data-testid="workspace-close-all" title={t('workspace.closeAll')} aria-label={t('workspace.closeAll')} onClick={closeAllFiles}><SquareX size={16} /></button>}
            <button
              className="icon-button"
              data-testid="workspace-mode-toggle"
              title={t(`workspace.mode.${modePreference}`)}
              aria-label={t(`workspace.mode.${modePreference}`)}
              onClick={cycleMode}
            >
              {modePreference === 'auto' ? <Sparkles size={15} /> : modePreference === 'docked' ? <Columns2 size={15} /> : <Layers size={15} />}
            </button>
            <button className="icon-button" data-testid="workspace-close" title={t('workspace.close')} onClick={close}><PanelRightClose size={16} /></button>
          </div>
        </div>
        {tab === 'review' ? <ReviewWorkspace /> : (
          <div className={`workspace-browser${fileTreeOpen ? ' tree-open' : ''}`}>
            <button className="workspace-tree-backdrop" aria-label={t('workspace.hideFiles')} tabIndex={fileTreeOpen ? 0 : -1} onClick={() => setFileTreeOpen(false)} />
            <FileExplorer selected={activeFile} onSelect={chooseFile} onRootCount={setRootItemCount} />
            <main className="workspace-preview" data-testid="workspace-preview">
              {activeFile ? <FilePreview path={activeFile} /> : <div className="workspace-empty">{t('workspace.selectFile')}</div>}
            </main>
          </div>
        )}
      </aside>
    </>
  );
}
