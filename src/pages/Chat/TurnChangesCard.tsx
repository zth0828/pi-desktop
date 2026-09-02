import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { collectTurnChanges } from '../../lib/turn-changes';
import {
  collectToolWarnings,
  editPreviewDiff,
  parseDiffLines,
  resultDetails,
  type ToolWarning,
} from '../../lib/tool-display';
import { FileIcon } from '../../components/FileIcon';
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

/**
 * 聚合编辑卡（Codex「已编辑 N 个文件 +x -y」范式）：一轮对话结束后在该轮尾部展示
 * 成功的 edit/write 汇总。「撤销」通过 review baseline 回滚该工具改动；
 * 「审核」打开完整 Review 面板。支持点击单行内嵌展开行级 Diff。
 */
export function TurnChangesCardView({ toolCallIds }: { toolCallIds: string[] }) {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const openReviewFile = usePaneChatStore((s) => s.openReviewFile);
  const openWorkspaceFile = usePaneChatStore((s) => s.openWorkspaceFile);
  const cwd = usePaneChatStore((s) => s.cwd);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [revertState, setRevertState] = useState<'idle' | 'reverting' | 'done' | 'error'>('idle');
  const [revertError, setRevertError] = useState('');
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const changes = collectTurnChanges(toolExecutions, toolCallIds);
  const visibleFiles = showAllFiles ? changes.files : changes.files.slice(0, 5);
  const hiddenCount = changes.files.length - visibleFiles.length;
  const normalizedCwd = cwd?.replace(/\\/g, '/').replace(/\/$/, '');
  const allFilesInWorkspace = changes.files.every((file) => {
    const normalized = file.path.replace(/\\/g, '/');
    return !normalized.startsWith('/') || Boolean(normalizedCwd && (
      normalized === normalizedCwd || normalized.startsWith(`${normalizedCwd}/`)
    ));
  });

  const displayPath = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    return normalizedCwd && normalized.startsWith(`${normalizedCwd}/`)
      ? normalized.slice(normalizedCwd.length + 1)
      : normalized;
  };

  useEffect(() => {
    let alive = true;
    paneApi.review
      .getSummary()
      .then((summary) => {
        if (alive) setGitAvailable(summary.available);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [paneApi]);

  if (changes.files.length === 0) return null;

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const revertAll = async () => {
    setRevertState('reverting');
    for (const file of changes.files) {
      const result = await paneApi.review.revertFile(file.path);
      if (!result.success) {
        setRevertState('error');
        setRevertError(result.error ?? '');
        return;
      }
    }
    setRevertState('done');
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
          <span className="turn-stat-add">+{changes.added}</span>
          <span className="turn-stat-del">-{changes.deleted}</span>
        </button>
        <span className="turn-changes-actions">
          {gitAvailable && allFilesInWorkspace && revertState !== 'done' && (
            <button
              className="turn-changes-btn"
              data-testid="turn-changes-revert"
              disabled={revertState === 'reverting'}
              onClick={() => void revertAll()}
            >
              {revertState === 'reverting' ? t('chat.turnChanges.reverting') : t('chat.turnChanges.revert')}
            </button>
          )}
          {revertState === 'done' && (
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
          {t('chat.turnChanges.revertFailed', { error: revertError })}
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
    </div>
  );
}

// toolCallIds 来自 groupLogicalTurns 的 useMemo 重算（每次 messages 变化
// 都产生新数组），按元素浅比较保证 memo 不被击穿；卡片自身已按 id 订阅 toolExecutions。
export const TurnChangesCard = memo(TurnChangesCardView, (prev, next) =>
  prev.toolCallIds.length === next.toolCallIds.length
  && prev.toolCallIds.every((id, i) => id === next.toolCallIds[i]));
