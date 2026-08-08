import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewFileEntry, ReviewSummaryResult } from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import {
  buildHunkPatch,
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

/** 单文件 unified diff 渲染：按 hunk 分组，hunk hover 出「回滚此 hunk」。 */
function FileDiffView({
  path,
  parsed,
  onRevertHunk,
}: {
  path: string;
  parsed: ParsedFileDiff;
  onRevertHunk: (hunkIndex: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="review-diff" data-testid="review-diff">
      {parsed.hunks.map((hunk, i) => (
        <div className="review-hunk" data-testid="review-hunk" key={i}>
          <div className="review-hunk-header">
            <span className="review-hunk-range">{hunk.header}</span>
            <button
              className="review-revert-btn"
              data-testid="revert-hunk"
              onClick={() => onRevertHunk(i)}
            >
              {t('review.revertHunk')}
            </button>
          </div>
          <pre className="diff-view">
            {hunk.lines.map((line, j) => {
              const kind = hunkLineKind(line);
              if (kind === 'marker') {
                return (
                  <div key={j} className="diff-line diff-skip">
                    <span className="diff-content">{line}</span>
                  </div>
                );
              }
              return (
                <div key={j} className={`diff-line diff-${kind}`}>
                  <span className="diff-sign">{kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}</span>
                  <span className="diff-content">{line.slice(1)}</span>
                </div>
              );
            })}
          </pre>
        </div>
      ))}
      {parsed.hunks.length === 0 && <div className="review-empty">{t('review.noDiff', { path })}</div>}
    </div>
  );
}

/** 非 git 降级视图：从工具执行记录列改动文件 + edit 内嵌 diff（pi 私有格式），无回滚。 */
function FallbackView() {
  const { t } = useTranslation();
  const toolExecutions = useChatStore((s) => s.toolExecutions);
  const files = collectFallbackFiles(toolExecutions);
  return (
    <div className="review-fallback" data-testid="review-fallback">
      <div className="review-hint">{t('review.fallbackHint')}</div>
      {files.length === 0 && <div className="review-empty">{t('review.empty')}</div>}
      {files.map((f) => (
        <div className="review-fallback-file" key={f.path}>
          <div className="review-file-name">{f.path}</div>
          {f.diff && (
            <pre className="diff-view" data-testid="diff-view">
              {parseDiffLines(f.diff).map((line, i) => (
                <div key={i} className={`diff-line diff-${line.kind}`}>
                  <span className="diff-linenum">{line.lineNum}</span>
                  <span className="diff-sign">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                  </span>
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

/**
 * Review 面板（Codex 式会话改动评审）：左侧文件列表（+A/-D），右侧活视图 diff。
 * git 仓库：baseline ghost commit ↔ 当前磁盘快照，支持文件/hunk 级回滚；
 * 非 git 目录：降级为工具执行记录的只读汇总。
 */
export function ReviewPanel() {
  const { t } = useTranslation();
  const open = useChatStore((s) => s.reviewOpen);
  const setReviewOpen = useChatStore((s) => s.setReviewOpen);
  const [summary, setSummary] = useState<ReviewSummaryResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<ParsedFileDiff | null>(null);
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    const s = await hostApi.review.getSummary().catch(() => null);
    setSummary(s);
    return s;
  }, []);

  const loadDiff = useCallback(async (path: string) => {
    const r = await hostApi.review.getFileDiff(path).catch(() => null);
    setDiff(r?.available && r.diff ? parseUnifiedDiff(r.diff) : null);
  }, []);

  // 打开时拉汇总；默认选中第一个文件
  useEffect(() => {
    if (!open) return;
    setRevertError(null);
    void refreshSummary().then((s) => {
      if (s?.available && s.files.length > 0) {
        setSelected((prev) => prev ?? s.files[0].path);
      }
    });
  }, [open, refreshSummary]);

  useEffect(() => {
    if (!open || !selected) return;
    void loadDiff(selected);
  }, [open, selected, loadDiff]);

  if (!open) return null;

  const selectFile = (path: string) => setSelected(path);

  const confirmRevert = async () => {
    if (!pendingRevert) return;
    const target = pendingRevert;
    setPendingRevert(null);
    const result =
      target.kind === 'file'
        ? await hostApi.review.revertFile(target.path)
        : await hostApi.review.revertHunk(target.path, target.patch);
    if (!result.success) {
      setRevertError(result.error ?? 'unknown');
      return;
    }
    setRevertError(null);
    const s = await refreshSummary();
    // 回滚后文件可能已无差异；保持选中并刷新 diff
    if (selected) await loadDiff(selected);
    if (s?.available && selected && !s.files.some((f) => f.path === selected)) {
      const next = s.files[0]?.path ?? null;
      setSelected(next);
      setDiff(null);
    }
  };

  const revertHunk = (path: string, hunkIndex: number) => {
    if (!diff) return;
    try {
      setPendingRevert({ kind: 'hunk', path, patch: buildHunkPatch(diff, hunkIndex) });
    } catch {
      setRevertError('invalid hunk');
    }
  };

  const files: ReviewFileEntry[] = summary?.available ? summary.files : [];

  return (
    <div className="tree-overlay" data-testid="review-panel" onClick={() => setReviewOpen(false)}>
      <div className="review-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tree-title">
          {t('review.title')}
          <button
            className="review-refresh-btn"
            data-testid="review-refresh"
            onClick={() => {
              void refreshSummary();
              if (selected) void loadDiff(selected);
            }}
          >
            {t('review.refresh')}
          </button>
        </div>
        {revertError && (
          <div className="review-error" data-testid="review-error">
            {t('review.revertFailed', { error: revertError })}
          </div>
        )}
        {summary && !summary.available && <FallbackView />}
        {(!summary || summary.available) && (
          <div className="review-body">
            <div className="review-file-list" data-testid="review-file-list">
              {files.length === 0 && <div className="review-empty">{t('review.empty')}</div>}
              {files.map((f) => (
                <div
                  key={f.path}
                  className={`review-file${selected === f.path ? ' selected' : ''}`}
                  data-testid="review-file"
                >
                  <button className="review-file-main" onClick={() => selectFile(f.path)}>
                    <span className="review-file-name">{f.path}</span>
                    <span className="review-file-stats">
                      <span className="review-stat-add">+{f.added}</span>
                      <span className="review-stat-del">-{f.deleted}</span>
                    </span>
                  </button>
                  <button
                    className="review-revert-btn"
                    data-testid="revert-file"
                    onClick={() => setPendingRevert({ kind: 'file', path: f.path })}
                  >
                    {t('review.revertFile')}
                  </button>
                </div>
              ))}
            </div>
            <div className="review-diff-pane">
              {selected && diff && (
                <FileDiffView path={selected} parsed={diff} onRevertHunk={(i) => revertHunk(selected, i)} />
              )}
              {selected && !diff && <div className="review-empty">{t('review.noDiff', { path: selected })}</div>}
              {!selected && <div className="review-empty">{t('review.empty')}</div>}
            </div>
          </div>
        )}

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
    </div>
  );
}
