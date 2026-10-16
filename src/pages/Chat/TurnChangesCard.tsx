import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronUp, GitBranch, RotateCcw } from 'lucide-react';
import { collectTurnChanges } from '../../lib/turn-changes';
import {
  collectToolWarnings,
  editPreviewDiff,
  parseDiffLines,
  resultDetails,
  type ToolWarning,
} from '../../lib/tool-display';
import { isAbsolutePath, isPathInside, normalizeDisplayPath, pathMapKey } from '../../lib/review-diff';
import { FileIcon } from '../../components/FileIcon';
import { formatErrorMessage } from '../../lib/error-formatter';
import type { PiRuntimeTreeNode, ReviewFileEntry } from '@shared/host-api/contract';
import { ConfirmUndoDialog, type ConfirmUndoFile } from './ConfirmUndoDialog';
import { usePaneChatStore, usePaneHostApi } from './chat-store-context';

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff-view" data-testid="diff-view">
      {parseDiffLines(diff).map((line, i) => (
        <div key={i} className={`diff-line diff-${line.kind}`}>
          <span className="diff-linenum">{line.lineNum}</span>
          <span className="diff-sign">
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
          </span>
          <span className="diff-content">{line.content}</span>
        </div>
      ))}
    </pre>
  );
}

function contentToPseudoDiff(content: string, startLine = 1): string {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, i) => ` ${startLine + i} ${line}`).join('\n');
}

function ToolWarnings({ warnings }: { warnings: ToolWarning[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <div className="tool-warnings">
      {warnings.map((w, i) => (
        <div key={i} className="tool-warning">
          {w.kind === 'fullOutput' && t('chat.tool.fullOutput', { path: w.path })}
          {w.kind === 'truncatedLines' &&
            t('chat.tool.truncatedLines', { outputLines: w.outputLines, totalLines: w.totalLines })}
          {w.kind === 'truncatedBytes' && t('chat.tool.truncatedBytes', { outputLines: w.outputLines })}
          {w.kind === 'matchLimit' && t('chat.tool.matchLimit', { limit: w.limit })}
          {w.kind === 'linesTruncated' && t('chat.tool.linesTruncated')}
        </div>
      ))}
    </div>
  );
}

export interface TurnChangesCardProps {
  toolCallIds: string[];
  userEntryId?: string;
  turnIndex?: number;
  branchCount?: number;
  isHistoricalTurn?: boolean;
}

/**
 * 聚合编辑卡（Codex「已编辑 N 个文件 +x -y」范式）：一轮对话结束后在该轮尾部展示
 * 成功的 edit/write 汇总。「撤销」通过 review baseline 回滚该工具改动；
 * 「审核」打开完整 Review 面板。支持点击单行内嵌展开行级 Diff 与单文件撤销。
 */
export function TurnChangesCardView({
  toolCallIds,
  userEntryId,
  turnIndex,
  branchCount,
  isHistoricalTurn,
}: TurnChangesCardProps) {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const openReviewFile = usePaneChatStore((s) => s.openReviewFile);
  const openWorkspaceFile = usePaneChatStore((s) => s.openWorkspaceFile);
  const setTreeOpen = usePaneChatStore((s) => s.setTreeOpen);
  const navigateTo = usePaneChatStore((s) => s.navigateTo);
  const cwd = usePaneChatStore((s) => s.cwd);
  const [gitAvailable, setGitAvailable] = useState(true);
  const [reviewFiles, setReviewFiles] = useState<ReviewFileEntry[]>([]);
  const [treeNodes, setTreeNodes] = useState<PiRuntimeTreeNode[]>([]);
  const [confirmUndoOpen, setConfirmUndoOpen] = useState(false);
  const [revertState, setRevertState] = useState<'idle' | 'reverting' | 'done' | 'error'>('idle');
  const [revertError, setRevertError] = useState('');
  const [revertingPath, setRevertingPath] = useState<string | null>(null);
  const [revertedFiles, setRevertedFiles] = useState<Set<string>>(new Set());
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const changes = collectTurnChanges(toolExecutions, toolCallIds);
  const activeFiles = changes.files.filter((file) => !revertedFiles.has(file.path));
  const remainingAdded = activeFiles.reduce((sum, f) => sum + f.added, 0);
  const remainingDeleted = activeFiles.reduce((sum, f) => sum + f.deleted, 0);
  const isFullyReverted = revertState === 'done' || (changes.files.length > 0 && activeFiles.length === 0);

  const visibleFiles = showAllFiles ? changes.files : changes.files.slice(0, 5);
  const hiddenCount = changes.files.length - visibleFiles.length;
  const allFilesInWorkspace = changes.files.every((file) => {
    const isAbs = isAbsolutePath(file.path);
    return isAbs ? isPathInside(file.path, cwd) : true;
  });

  const displayPath = (filePath: string) => normalizeDisplayPath(filePath, cwd);

  const undoFiles: ConfirmUndoFile[] = activeFiles.map((file) => {
    const norm = displayPath(file.path);
    const targetKey = pathMapKey(norm);
    const reviewEntry = reviewFiles.find((rf) => pathMapKey(rf.path) === targetKey);
    let action: 'delete' | 'revert' | 'restore';
    if (reviewEntry?.status === 'added') {
      action = 'delete';
    } else if (reviewEntry?.status === 'deleted') {
      action = 'restore';
    } else if (reviewEntry?.status === 'modified') {
      action = 'revert';
    } else {
      const execution = file.toolCallId ? toolExecutions[file.toolCallId] : undefined;
      if (execution?.toolName === 'write' || (file.deleted === 0 && file.added > 0)) {
        action = 'delete';
      } else if (file.added === 0 && file.deleted > 0) {
        action = 'restore';
      } else {
        action = 'revert';
      }
    }
    return {
      path: norm,
      action,
    };
  });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkSummary = () => {
      paneApi.review
        .getSummary()
        .then((summary) => {
          if (!alive) return;
          setGitAvailable(summary.available);
          if (Array.isArray(summary.files)) {
            setReviewFiles(summary.files);
          }
          if (!summary.available && summary.reason === 'capturing') {
            timer = setTimeout(checkSummary, 500);
          }
        })
        .catch(() => {});
    };

    checkSummary();

    paneApi.piRuntime
      .getTree()
      .then((res) => {
        if (!alive) return;
        setTreeNodes(res.nodes ?? []);
      })
      .catch(() => {});

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [paneApi, userEntryId]);

  if (changes.files.length === 0) return null;

  const userNode = userEntryId ? treeNodes.find((n) => n.id === userEntryId) : undefined;
  const branchRoutesCount = branchCount ?? (userNode?.branchCount ?? 1);
  const turnNumber = (turnIndex ?? 0) + 1;

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const handleRevertSingleFile = async (filePath: string) => {
    setRevertingPath(filePath);
    try {
      const result = await paneApi.review.revertFile(filePath);
      if (result.success) {
        setRevertedFiles((prev) => {
          const next = new Set(prev);
          next.add(filePath);
          if (next.size >= changes.files.length) {
            setRevertState('done');
          }
          return next;
        });
      } else {
        setRevertError(result.error ?? '');
        setRevertState('error');
      }
    } catch (err) {
      setRevertError(String(err));
      setRevertState('error');
    } finally {
      setRevertingPath(null);
    }
  };

  const revertAll = async (): Promise<boolean> => {
    setRevertState('reverting');
    if (turnIndex !== undefined && paneApi.review?.revertToTurnCheckpoint) {
      try {
        const res = await paneApi.review.revertToTurnCheckpoint(turnIndex);
        if (res.success) {
          setRevertedFiles(new Set(changes.files.map((f) => f.path)));
          setRevertState('done');
          return true;
        } else if (res.error === 'conflicted files cannot be reverted') {
          setRevertState('error');
          setRevertError(res.error);
          return false;
        }
      } catch {
        // fallback to per-file revert
      }
    }
    for (const file of changes.files) {
      if (revertedFiles.has(file.path)) continue;
      const result = await paneApi.review.revertFile(file.path);
      if (!result.success) {
        setRevertState('error');
        setRevertError(result.error ?? '');
        return false;
      }
      setRevertedFiles((prev) => new Set([...prev, file.path]));
    }
    setRevertState('done');
    return true;
  };

  const handleConfirmUndo = async (options: { revertFiles: boolean; rewindConversation: boolean }) => {
    setConfirmUndoOpen(false);
    let filesReverted = true;
    if (options.revertFiles) {
      filesReverted = await revertAll();
    }
    if (!filesReverted) return;
    if (options.rewindConversation && userEntryId) {
      if (navigateTo) {
        await navigateTo(userEntryId);
      } else {
        await paneApi.piRuntime.navigateTree(userEntryId);
      }
    }
  };

  return (
    <div className="turn-changes" data-testid="turn-changes">
      <div className="turn-changes-header">
        <div className="turn-changes-summary">
          <span className="turn-changes-title" data-testid="turn-changes-title">
            {t('chat.turnChanges.title', { count: changes.files.length })}
          </span>
          <button
            className="turn-changes-view"
            data-testid="turn-changes-view"
            onClick={() => openReviewFile(changes.files[0]?.path)}
          >
            {t('chat.turnChanges.viewChanges')}
          </button>
        </div>
        <button
          type="button"
          className="turn-changes-stats-btn"
          data-testid="turn-changes-stats-btn"
          title={t('chat.turnChanges.viewChanges')}
          onClick={() => openReviewFile(changes.files[0]?.path)}
        >
          <span className="turn-stat-add">+{remainingAdded}</span>
          <span className="turn-stat-del">-{remainingDeleted}</span>
        </button>

        {branchRoutesCount > 1 ? (
          <button
            type="button"
            className="turn-changes-branches-btn"
            data-testid="turn-changes-branches"
            title={t('chat.turnChanges.viewBranchRoutes')}
            onClick={() => setTreeOpen(true)}
          >
            <GitBranch size={12} />
            <span>{t('chat.turnChanges.branchRoutes', { count: branchRoutesCount })}</span>
            <span className="turn-changes-branch-action">{t('chat.turnChanges.viewBranchRoutes')}</span>
          </button>
        ) : (
          <span className="turn-changes-snapshot" data-testid="turn-changes-snapshot">
            {t('chat.turnChanges.snapshot', { n: turnNumber })}
          </span>
        )}

        <span className="turn-changes-actions">
          {gitAvailable && allFilesInWorkspace && !isFullyReverted && (
            <button
              className="turn-changes-btn"
              data-testid="turn-changes-revert"
              disabled={revertState === 'reverting'}
              onClick={() => setConfirmUndoOpen(true)}
            >
              {revertState === 'reverting' ? t('chat.turnChanges.reverting') : t('chat.turnChanges.revert')}
            </button>
          )}
          {isFullyReverted && (
            <span className="turn-changes-reverted" data-testid="turn-changes-reverted">
              {t('chat.turnChanges.reverted')}
            </span>
          )}
          <button
            className="turn-changes-btn"
            data-testid="turn-changes-review"
            onClick={() => openReviewFile(changes.files[0]?.path)}
          >
            {t('chat.turnChanges.review')}
          </button>
        </span>
      </div>
      {revertState === 'error' && (
        <div className="turn-changes-error" data-testid="turn-changes-error">
          {t('chat.turnChanges.revertFailed', {
            error: formatErrorMessage(revertError, t) ?? revertError,
          })}
        </div>
      )}
      <div className="turn-changes-files">
        {visibleFiles.map((file) => {
          const execution = file.toolCallId ? toolExecutions[file.toolCallId] : undefined;
          const details = execution ? resultDetails(execution.result) : undefined;
          const realDiff = typeof details?.diff === 'string' ? details.diff : undefined;
          const previewDiff = !realDiff && execution?.toolName === 'edit'
            ? editPreviewDiff(execution.args)
            : undefined;
          const diff = realDiff ?? previewDiff;
          const writeRaw = execution?.toolName === 'write'
            ? (execution.args as { content?: unknown } | undefined)?.content
            : undefined;
          const writeContent = typeof writeRaw === 'string' && writeRaw.trim().length > 0 ? writeRaw : null;
          const warnings = collectToolWarnings(details);
          const isExpanded = Boolean(expandedFiles[file.path]);
          const isFileReverted = revertedFiles.has(file.path);

          return (
            <div className="turn-changes-file-item" key={file.path}>
              <div
                className="turn-changes-file"
                data-testid="turn-changes-file"
                onClick={() => toggleFile(file.path)}
              >
                <FileIcon name={file.path} size={14} />
                <button
                  type="button"
                  className="turn-changes-path"
                  data-testid="turn-changes-open-file"
                  title={t('chat.turnChanges.openFile')}
                  aria-label={t('chat.turnChanges.openFile')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openWorkspaceFile(file.path);
                  }}
                >
                  {displayPath(file.path)}
                </button>
                <button
                  type="button"
                  className="turn-changes-stat-btn"
                  data-testid="turn-changes-stat-btn"
                  title={t('chat.turnChanges.viewChanges')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openReviewFile(file.path);
                  }}
                >
                  <span className="turn-stat-add">+{file.added}</span>
                  <span className="turn-stat-del">-{file.deleted}</span>
                </button>

                {isFileReverted ? (
                  <span
                    className="turn-changes-file-reverted"
                    data-testid="turn-changes-file-reverted"
                  >
                    <Check size={12} />
                    <span>{t('chat.turnChanges.fileReverted')}</span>
                  </span>
                ) : gitAvailable && (
                  <button
                    type="button"
                    className="turn-changes-inline-revert"
                    data-testid="turn-changes-file-revert"
                    title={t('chat.turnChanges.revertFileTooltip')}
                    disabled={revertState === 'reverting' || revertingPath === file.path}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRevertSingleFile(file.path);
                    }}
                  >
                    <RotateCcw size={12} />
                    <span>{t('chat.turnChanges.revertFile')}</span>
                  </button>
                )}

                <span className="turn-changes-chevron">
                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </span>
              </div>

              {isExpanded && (diff || writeContent !== null) && (
                <div className="turn-changes-inline-diff" data-testid="turn-changes-inline-diff">
                  {diff ? (
                    <DiffView diff={diff} />
                  ) : writeContent !== null ? (
                    <DiffView diff={contentToPseudoDiff(writeContent.trimEnd())} />
                  ) : null}
                  <ToolWarnings warnings={warnings} />
                </div>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <button className="turn-changes-more" data-testid="turn-changes-more" onClick={() => setShowAllFiles(true)}>
            {t('chat.turnChanges.showMore', { count: hiddenCount })}<ChevronDown size={14} />
          </button>
        )}
        {showAllFiles && changes.files.length > 5 && (
          <button className="turn-changes-more" data-testid="turn-changes-less" onClick={() => setShowAllFiles(false)}>
            {t('chat.turnChanges.showLess')}<ChevronUp size={14} />
          </button>
        )}
      </div>

      <ConfirmUndoDialog
        open={confirmUndoOpen}
        files={undoFiles}
        targetTurnIndex={turnIndex}
        isHistoricalTurn={isHistoricalTurn}
        isReverting={revertState === 'reverting'}
        onConfirm={handleConfirmUndo}
        onClose={() => setConfirmUndoOpen(false)}
      />
    </div>
  );
}

// toolCallIds 来自 groupLogicalTurns 的 useMemo 重算（每次 messages 变化
// 都产生新数组），按元素浅比较保证 memo 不被击穿；卡片自身已按 id 订阅 toolExecutions。
export const TurnChangesCard = memo(TurnChangesCardView, (prev, next) =>
  prev.userEntryId === next.userEntryId
  && prev.turnIndex === next.turnIndex
  && prev.isHistoricalTurn === next.isHistoricalTurn
  && prev.branchCount === next.branchCount
  && prev.toolCallIds.length === next.toolCallIds.length
  && prev.toolCallIds.every((id, i) => id === next.toolCallIds[i]));

