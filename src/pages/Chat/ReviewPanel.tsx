import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  File,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  List,
  PanelRightClose,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type {
  ReviewFileEntry,
  ReviewSummaryResult,
  WorkspaceEntry,
  WorkspaceReadResult,
} from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import {
  buildHunkPatch,
  buildSplitDiffRows,
  collectFallbackFiles,
  hunkLineKind,
  parseUnifiedDiff,
  type ParsedFileDiff,
} from '../../lib/review-diff';
import { parseDiffLines } from '../../lib/tool-display';
import { useChatStore } from '../../stores/chat';

type PendingRevert =
  | { kind: 'file'; path: string }
  | { kind: 'hunk'; path: string; patch: string };
type WorkbenchTab = 'files' | 'review' | `file:${string}`;

function FallbackView() {
  const { t } = useTranslation();
  const toolExecutions = useChatStore((s) => s.toolExecutions);
  const files = collectFallbackFiles(toolExecutions);
  return (
    <div className="review-fallback" data-testid="review-fallback">
      <div className="review-hint">{t('review.fallbackHint')}</div>
      {files.length === 0 && <div className="review-empty">{t('review.empty')}</div>}
      {files.map((file) => (
        <div className="review-fallback-file" key={file.path}>
          <div className="review-file-name">{file.path}</div>
          {file.diff && (
            <pre className="diff-view" data-testid="diff-view">
              {parseDiffLines(file.diff).map((line, index) => (
                <div key={index} className={`diff-line diff-${line.kind}`}>
                  <span className="diff-linenum">{line.lineNum}</span>
                  <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
                  <span className="diff-content">{line.content}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function UnifiedDiff({ parsed, onRevert }: { parsed: ParsedFileDiff; onRevert: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="review-diff" data-testid="review-diff">
      {parsed.hunks.map((hunk, index) => (
        <div className="review-hunk" key={index}>
          <div className="review-hunk-header"><span className="review-hunk-range">{hunk.header}</span><button className="review-revert-btn" data-testid="revert-hunk" onClick={() => onRevert(index)}>{t('review.revertHunk')}</button></div>
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

function SplitDiff({ parsed, onRevert }: { parsed: ParsedFileDiff; onRevert: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="review-diff review-split" data-testid="review-diff">
      {parsed.hunks.map((hunk, index) => (
        <div className="split-hunk" key={index} data-testid="diff-split">
          <div className="split-hunk-header"><span>{hunk.header}</span><button className="review-revert-btn" data-testid="revert-hunk" onClick={() => onRevert(index)}>{t('review.revertHunk')}</button></div>
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

function FileExplorer({ selected, onSelect }: { selected: string | null; onSelect: (path: string) => void }) {
  const { t } = useTranslation();
  const [children, setChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [filter, setFilter] = useState('');

  const load = useCallback(async (dir: string) => {
    const result = await hostApi.workspace.listChildren(dir).catch(() => null);
    if (result) setChildren((current) => ({ ...current, [dir]: result.entries }));
  }, []);

  useEffect(() => { void load(''); }, [load]);

  const toggle = (entry: WorkspaceEntry) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!children[entry.path]) void load(entry.path);
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
            ) : <><span className="workspace-tree-indent" /><File size={14} /></>}
            <span>{entry.name}</span>
          </button>
          {entry.kind === 'directory' && open && renderEntries(entry.path, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="workspace-tree" data-testid="workspace-tree">
      <label className="workspace-filter">
        <Search size={14} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('workspace.filter')} />
      </label>
      <div className="workspace-tree-scroll">{renderEntries('', 0)}</div>
    </aside>
  );
}

function FilePreview({ path }: { path: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<WorkspaceReadResult | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setResult(null);
    setError(false);
    void hostApi.workspace.readFile(path).then(setResult).catch(() => setError(true));
  }, [path]);
  if (error) return <div className="workspace-empty">{t('workspace.readFailed')}</div>;
  if (!result) return <div className="workspace-empty">{t('workspace.loading')}</div>;
  if (result.truncated && !result.data && !result.text) {
    return <div className="workspace-empty">{t('workspace.tooLarge', { size: result.size.toLocaleString() })}</div>;
  }
  if (result.kind === 'image' && result.data) {
    return <div className="workspace-image-preview" data-testid="workspace-image-preview"><img src={`data:${result.mimeType};base64,${result.data}`} alt={result.name} /></div>;
  }
  if (result.kind === 'text') {
    return (
      <div className="workspace-text-preview" data-testid="workspace-text-preview">
        {result.truncated && <div className="workspace-truncated">{t('workspace.truncated')}</div>}
        <pre><code>{result.text}</code></pre>
      </div>
    );
  }
  return <div className="workspace-empty">{t('workspace.binary', { size: result.size.toLocaleString() })}</div>;
}

function ReviewWorkspace() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ReviewSummaryResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<ParsedFileDiff | null>(null);
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const [showFiles, setShowFiles] = useState(true);
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    const next = await hostApi.review.getSummary().catch(() => null);
    setSummary(next);
    if (next?.available && next.files.length > 0) {
      setSelected((current) => current && next.files.some((file) => file.path === current) ? current : next.files[0].path);
    }
    return next;
  }, []);
  const loadDiff = useCallback(async (path: string) => {
    const result = await hostApi.review.getFileDiff(path).catch(() => null);
    setDiff(result?.available && result.diff ? parseUnifiedDiff(result.diff) : null);
  }, []);
  useEffect(() => { void refreshSummary(); }, [refreshSummary]);
  useEffect(() => { if (selected) void loadDiff(selected); }, [selected, loadDiff]);

  const confirmRevert = async () => {
    if (!pendingRevert) return;
    const target = pendingRevert;
    setPendingRevert(null);
    const result = target.kind === 'file'
      ? await hostApi.review.revertFile(target.path)
      : await hostApi.review.revertHunk(target.path, target.patch);
    if (!result.success) {
      setRevertError(result.error ?? 'unknown');
      return;
    }
    setRevertError(null);
    await refreshSummary();
    if (selected) await loadDiff(selected);
  };

  if (summary && !summary.available) return <FallbackView />;
  const files: ReviewFileEntry[] = summary?.files ?? [];
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
            {files.length === 0 && <div className="review-empty">{t('review.empty')}</div>}
            {files.map((file) => (
              <div className={`review-file${selected === file.path ? ' selected' : ''}`} data-testid="review-file" key={file.path}>
                <button className="review-file-main" onClick={() => setSelected(file.path)}>
                  <span className="review-file-name">{file.path}</span>
                  <span className="review-file-stats"><span className="review-stat-add">+{file.added}</span><span className="review-stat-del">-{file.deleted}</span></span>
                </button>
                <button className="review-revert-btn" data-testid="revert-file" onClick={() => setPendingRevert({ kind: 'file', path: file.path })}>{t('review.revertFile')}</button>
              </div>
            ))}
          </div>
        )}
        <div className="review-diff-pane">
          {selected && diff && (
            <>
              <div className="review-file-heading">
                <FileCode2 size={15} /><span>{selected}</span>
              </div>
              {mode === 'split'
                ? <SplitDiff parsed={diff} onRevert={(index) => setPendingRevert({ kind: 'hunk', path: selected, patch: buildHunkPatch(diff, index) })} />
                : <UnifiedDiff parsed={diff} onRevert={(index) => setPendingRevert({ kind: 'hunk', path: selected, patch: buildHunkPatch(diff, index) })} />}
            </>
          )}
          {selected && !diff && <div className="review-empty">{t('review.noDiff', { path: selected })}</div>}
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
  const reviewOpen = useChatStore((s) => s.reviewOpen);
  const workspaceOpen = useChatStore((s) => s.workspaceOpen);
  const setReviewOpen = useChatStore((s) => s.setReviewOpen);
  const setWorkspaceOpen = useChatStore((s) => s.setWorkspaceOpen);
  const workspaceFileRequest = useChatStore((s) => s.workspaceFileRequest);
  const [tab, setTab] = useState<WorkbenchTab>('files');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [panelWidth, setPanelWidth] = useState<number>();
  const [resizing, setResizing] = useState(false);
  const open = reviewOpen || workspaceOpen;
  useEffect(() => { if (reviewOpen) setTab('review'); else if (workspaceOpen && tab === 'review') setTab('files'); }, [reviewOpen, workspaceOpen, tab]);
  useEffect(() => {
    if (!workspaceFileRequest) return;
    const { path } = workspaceFileRequest;
    setSelectedFile(path);
    setOpenFiles((current) => current.includes(path) ? current : [...current, path]);
    setTab(`file:${path}`);
  }, [workspaceFileRequest]);
  useEffect(() => {
    if (!resizing) return;
    const resize = (event: PointerEvent) => {
      const maximum = Math.max(440, window.innerWidth - 460);
      setPanelWidth(Math.min(maximum, Math.max(440, window.innerWidth - event.clientX)));
    };
    const stop = () => setResizing(false);
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stop);
    };
  }, [resizing]);
  const chooseFile = (path: string) => {
    setSelectedFile(path);
    setOpenFiles((current) => current.includes(path) ? current : [...current, path]);
    setTab(`file:${path}`);
  };
  const close = () => { setReviewOpen(false); setWorkspaceOpen(false); };
  const fileTab = tab.startsWith('file:') ? tab.slice(5) : null;
  const activeFile = fileTab ?? selectedFile;
  const titleFor = (path: string) => path.split('/').pop() ?? path;
  if (!open) return null;
  return (
    <aside className={`workspace-panel${resizing ? ' resizing' : ''}`} data-testid="review-panel" style={panelWidth ? { width: panelWidth } : undefined}>
      <div
        className="workspace-resize-handle"
        data-testid="workspace-resize-handle"
        role="separator"
        aria-label={t('workspace.resize')}
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => { event.preventDefault(); setResizing(true); }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const current = panelWidth ?? Math.min(820, window.innerWidth * 0.5);
          const delta = event.key === 'ArrowLeft' ? 24 : -24;
          setPanelWidth(Math.min(Math.max(440, window.innerWidth - 460), Math.max(440, current + delta)));
        }}
      />
      <div className="workspace-tabs">
        <button className={`workspace-tab${tab === 'files' ? ' active' : ''}`} data-testid="workspace-files-tab" onClick={() => { setWorkspaceOpen(true); setTab('files'); }}><Files size={14} />{t('workspace.files')}</button>
        {openFiles.map((path) => (
          <button className={`workspace-tab${tab === `file:${path}` ? ' active' : ''}`} key={path} title={path} onClick={() => { setWorkspaceOpen(true); setTab(`file:${path}`); }}>{titleFor(path)}<X size={12} onClick={(event) => { event.stopPropagation(); setOpenFiles((current) => current.filter((item) => item !== path)); if (tab === `file:${path}`) setTab('files'); }} /></button>
        ))}
        <button className={`workspace-tab${tab === 'review' ? ' active' : ''}`} data-testid="workspace-review-tab" onClick={() => { setReviewOpen(true); setTab('review'); }}><FileCode2 size={14} />{t('review.title')}</button>
        <span className="spacer" />
        <button className="icon-button" data-testid="workspace-close" title={t('workspace.close')} onClick={close}><PanelRightClose size={16} /></button>
      </div>
      {tab === 'review' ? <ReviewWorkspace /> : (
        <div className="workspace-browser">
          <FileExplorer selected={activeFile} onSelect={chooseFile} />
          <main className="workspace-preview">
            {activeFile ? <FilePreview path={activeFile} /> : <div className="workspace-empty">{t('workspace.selectFile')}</div>}
          </main>
        </div>
      )}
    </aside>
  );
}
