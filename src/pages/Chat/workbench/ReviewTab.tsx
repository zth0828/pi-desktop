import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Columns2, FileCode2, Files, List, RefreshCw } from 'lucide-react';
import type { ReviewSummaryResult } from '@shared/host-api/contract';
import { FileIcon } from '../../../components/FileIcon';
import {
  buildHunkPatch,
  buildSplitDiffRows,
  collectFallbackFiles,
  hunkLineKind,
  mergeReviewFiles,
  parseUnifiedDiff,
  sessionChangeFiles,
  type ParsedFileDiff,
} from '../../../lib/review-diff';
import { parseDiffLines } from '../../../lib/tool-display';
import { usePaneChatStore, usePaneHostApi } from '../chat-store-context';
import type { PendingRevert } from './types';

export function UnifiedDiff({ parsed, onRevert }: { parsed: ParsedFileDiff; onRevert?: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="review-diff" data-testid="review-diff">
      {parsed.hunks.map((hunk, index) => (
        <div className="review-hunk" key={index}>
          <div className="review-hunk-header">
            <span className="review-hunk-range">{hunk.header}</span>
            {onRevert && (
              <button className="review-revert-btn" data-testid="revert-hunk" onClick={() => onRevert(index)}>
                {t('review.revertHunk')}
              </button>
            )}
          </div>
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
          </pre>
        </div>
      ))}
    </div>
  );
}

export function SplitDiff({ parsed, onRevert }: { parsed: ParsedFileDiff; onRevert?: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="review-diff review-split" data-testid="review-diff">
      {parsed.hunks.map((hunk, index) => (
        <div className="split-hunk" key={index} data-testid="diff-split">
          <div className="split-hunk-header">
            <span>{hunk.header}</span>
            {onRevert && (
              <button className="review-revert-btn" data-testid="revert-hunk" onClick={() => onRevert(index)}>
                {t('review.revertHunk')}
              </button>
            )}
          </div>
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

type SelectedReviewItem = {
  group: 'session' | 'workspace';
  path: string;
};

const DEFAULT_REVIEW_LIST_WIDTH = 240;
const MIN_REVIEW_LIST_WIDTH = 200;
const MAX_REVIEW_LIST_WIDTH = 450;
const REVIEW_LIST_WIDTH_STORAGE_KEY = 'pi-desktop.review-tree-width';

export function ReviewWorkspace() {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const cwd = usePaneChatStore((s) => s.cwd);
  const reviewFileRequest = usePaneChatStore((s) => s.reviewFileRequest);
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
  const [reviewListWidth, setReviewListWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(REVIEW_LIST_WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_REVIEW_LIST_WIDTH && saved <= MAX_REVIEW_LIST_WIDTH
      ? saved
      : DEFAULT_REVIEW_LIST_WIDTH;
  });
  const [reviewListResizing, setReviewListResizing] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(REVIEW_LIST_WIDTH_STORAGE_KEY, String(Math.round(reviewListWidth)));
  }, [reviewListWidth]);

  const onReviewListResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const resizer = e.currentTarget;
    resizer.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = reviewListWidth;
    let isDragging = false;

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (!isDragging && Math.abs(deltaX) >= 2) {
        isDragging = true;
        setReviewListResizing(true);
      }
      if (isDragging) {
        const clamped = Math.max(MIN_REVIEW_LIST_WIDTH, Math.min(MAX_REVIEW_LIST_WIDTH, startWidth + deltaX));
        setReviewListWidth(clamped);
      }
    };

    const onPointerUp = (upEvent: globalThis.PointerEvent) => {
      if (resizer.hasPointerCapture(upEvent.pointerId)) {
        resizer.releasePointerCapture(upEvent.pointerId);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setReviewListResizing(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const sessionFiles = useMemo(() => sessionChangeFiles(toolExecutions, cwd), [toolExecutions, cwd]);
  const toolFiles = useMemo(() => collectFallbackFiles(toolExecutions), [toolExecutions]);
  const workspaceFiles = useMemo(
    () =>
      mergeReviewFiles(
        cwd,
        Boolean(summary?.available),
        summary?.available ? summary.files : [],
        toolFiles,
      ),
    [cwd, summary, toolFiles],
  );

  const toolFileFor = useCallback(
    (filePath: string) => {
      const root = cwd?.replace(/\\/g, '/').replace(/\/$/, '');
      return toolFiles.find((file) => {
        const normalized = file.path.replace(/\\/g, '/');
        const displayPath = root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
        return displayPath === filePath;
      });
    },
    [cwd, toolFiles],
  );

  const isBaselineFile = useCallback(
    (filePath: string) => Boolean(summary?.available && summary.files.some((file) => file.path === filePath)),
    [summary],
  );

  const refreshSummary = useCallback(async () => {
    const next = await paneApi.review.getSummary().catch(() => null);
    setSummary(next);
    return next;
  }, [paneApi]);

  const loadDiff = useCallback(
    async (item: SelectedReviewItem) => {
      if (item.group === 'session') {
        const sessionFile = sessionFiles.find((f) => f.path === item.path);
        if (sessionFile?.diff) {
          setDiff(null);
          setToolDiff(sessionFile.diff);
          return;
        }
        if (summary?.available && summary.files.some((file) => file.path === item.path)) {
          const result = await paneApi.review.getFileDiff(item.path).catch(() => null);
          if (result?.available && result.diff) {
            setDiff(parseUnifiedDiff(result.diff));
            setToolDiff(null);
            return;
          }
        }
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
    },
    [sessionFiles, summary, paneApi, toolFileFor],
  );

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    if (summary && !summary.available && summary.reason === 'capturing') {
      const timer = window.setTimeout(() => {
        void refreshSummary();
      }, 1000);
      return () => window.clearTimeout(timer);
    }
  }, [summary, refreshSummary]);

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
    if (!reviewFileRequest?.path) return;
    const target = reviewFileRequest.path;
    const sessionMatch = sessionFiles.find((f) => f.path === target);
    if (sessionMatch) {
      setSelected({ group: 'session', path: target });
      setSessionOpen(true);
      return;
    }
    const workspaceMatch = workspaceFiles.find((f) => f.path === target);
    if (workspaceMatch) {
      setSelected({ group: 'workspace', path: target });
      setWorkspaceOpen(true);
      return;
    }
    if (sessionFiles.length > 0) {
      setSelected({ group: 'session', path: target });
      setSessionOpen(true);
    } else {
      setSelected({ group: 'workspace', path: target });
      setWorkspaceOpen(true);
    }
  }, [reviewFileRequest, sessionFiles, workspaceFiles]);

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
    const result =
      target.kind === 'file'
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
  const selectedWorkspaceFile =
    selected?.group === 'workspace' ? workspaceFiles.find((file) => file.path === selected.path) : undefined;
  const canRevertSelected = Boolean(selectedIsBaseline && selectedWorkspaceFile?.status !== 'conflicted');
  const selectedSessionFile =
    selected?.group === 'session' ? sessionFiles.find((file) => file.path === selected.path) : undefined;

  return (
    <div className="review-workspace">
      <div className="review-toolbar">
        <button
          className="icon-button"
          data-testid="review-refresh"
          title={t('review.refresh')}
          onClick={() => {
            void refreshSummary();
            if (selected) void loadDiff(selected);
          }}
        >
          <RefreshCw size={15} />
        </button>
        <span className="spacer" />
        <button
          className="icon-button"
          data-testid="review-toggle-mode"
          title={mode === 'split' ? t('review.unified') : t('review.split')}
          onClick={() => setMode((current) => (current === 'split' ? 'unified' : 'split'))}
        >
          {mode === 'split' ? <List size={15} /> : <Columns2 size={15} />}
        </button>
        <button
          className={`icon-button${showFiles ? ' active' : ''}`}
          data-testid="review-toggle-files"
          title={showFiles ? t('review.hideFiles') : t('review.showFiles')}
          onClick={() => setShowFiles((current) => !current)}
        >
          <Files size={15} />
        </button>
      </div>
      {revertError && (
        <div className="review-error" data-testid="review-error">
          {t('review.revertFailed', { error: revertError })}
        </div>
      )}
      <div
        className={`review-body${reviewListResizing ? ' list-resizing' : ''}`}
        style={{ '--review-tree-width': `${reviewListWidth}px` } as CSSProperties}
      >
        {showFiles && (
          <>
            <div className="review-file-list" data-testid="review-file-list">
              {summary && !summary.available && summary.reason === 'directory-too-large' && (
                <div className="review-status-notice" data-testid="review-directory-too-large">
                  {t('review.directoryTooLarge')}
                </div>
              )}
              {summary && !summary.available && summary.reason === 'capturing' && (
                <div className="review-status-notice" data-testid="review-baseline-capturing">
                  {t('review.baselineCapturing')}
                </div>
              )}
              {sessionFiles.length === 0 && workspaceFiles.length === 0 && (
                <div className="review-empty">
                  {summary && !summary.available && summary.reason === 'capturing' ? (
                    t('review.baselineCapturing')
                  ) : summary && !summary.available && summary.reason === 'directory-too-large' ? (
                    t('review.directoryTooLarge')
                  ) : (
                    t('review.empty')
                  )}
                </div>
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
                  {sessionOpen &&
                    sessionFiles.map((file) => (
                      <div
                        className={`review-file${selected?.group === 'session' && selected.path === file.path ? ' selected' : ''}`}
                        data-testid="review-file"
                        key={`session:${file.path}`}
                      >
                        <button
                          className="review-file-main"
                          onClick={() => setSelected({ group: 'session', path: file.path })}
                        >
                          <FileIcon name={file.path} size={14} />
                          <span className="review-file-name" title={file.path}>
                            {file.path}
                          </span>
                          <span className="review-file-status" data-testid="review-file-scope">
                            {t('review.sessionScope')}
                          </span>
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
                  {workspaceOpen &&
                    workspaceFiles.map((file) => {
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
                            <FileIcon name={file.path} size={14} />
                            <span className="review-file-name" title={file.path}>
                              {file.path}
                            </span>
                            {!baselineFile && (
                              <span className="review-file-status" data-testid="review-file-status">
                                {t('review.readOnly')}
                              </span>
                            )}
                            {file.status === 'conflicted' && (
                              <span className="review-file-status status-conflicted" data-testid="review-file-status">
                                {t('review.status.conflicted')}
                              </span>
                            )}
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
            <div
              className="review-tree-resizer"
              data-testid="review-tree-resizer"
              role="separator"
              aria-label={t('review.resizeList')}
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={onReviewListResizeStart}
              onDoubleClick={() => setReviewListWidth(DEFAULT_REVIEW_LIST_WIDTH)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                e.stopPropagation();
                const delta = e.key === 'ArrowLeft' ? -16 : 16;
                setReviewListWidth((w) => Math.max(MIN_REVIEW_LIST_WIDTH, Math.min(MAX_REVIEW_LIST_WIDTH, w + delta)));
              }}
            />
          </>
        )}
        <div className="review-diff-pane">
          {selected && diff && (
            <>
              <div className="review-file-heading">
                <FileCode2 size={15} />
                <span>{selected.path}</span>
                <span className="review-file-status">{t('review.workspaceScope')}</span>
              </div>
              {mode === 'split' ? (
                <SplitDiff
                  parsed={diff}
                  onRevert={
                    canRevertSelected
                      ? (index) =>
                          setPendingRevert({
                            kind: 'hunk',
                            path: selected.path,
                            patch: buildHunkPatch(diff, index),
                          })
                      : undefined
                  }
                />
              ) : (
                <UnifiedDiff
                  parsed={diff}
                  onRevert={
                    canRevertSelected
                      ? (index) =>
                          setPendingRevert({
                            kind: 'hunk',
                            path: selected.path,
                            patch: buildHunkPatch(diff, index),
                          })
                      : undefined
                  }
                />
              )}
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
          {selected && !diff && !toolDiff && (
            <div className="review-empty">{t('review.noDiff', { path: selected.path })}</div>
          )}
          {!selected && (
            <div className="review-empty">
              {summary && !summary.available && summary.reason === 'capturing' ? (
                t('review.baselineCapturing')
              ) : summary && !summary.available && summary.reason === 'directory-too-large' ? (
                t('review.directoryTooLarge')
              ) : (
                t('review.empty')
              )}
            </div>
          )}
        </div>
      </div>
      {pendingRevert && (
        <div className="review-confirm-overlay" data-testid="review-confirm">
          <div className="review-confirm">
            <div className="review-confirm-text">
              {pendingRevert.kind === 'file'
                ? t('review.confirmFile', { path: pendingRevert.path })
                : t('review.confirmHunk', { path: pendingRevert.path })}
            </div>
            <div className="review-confirm-actions">
              <button className="chat-toolbar-btn" onClick={() => setPendingRevert(null)}>
                {t('review.cancel')}
              </button>
              <button
                className="chat-toolbar-btn review-confirm-danger"
                data-testid="review-confirm-ok"
                onClick={() => void confirmRevert()}
              >
                {t('review.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
