import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { collectTurnChanges } from '../../lib/turn-changes';
import { usePaneChatStore, usePaneHostApi } from './chat-store-context';

/**
 * 聚合编辑卡（Codex「已编辑 N 个文件 +x -y」范式）：一轮对话结束后在该轮尾部展示
 * 成功的 edit/write 汇总。「撤销」通过 review baseline 回滚该工具改动；
 * 「审核」打开完整 Review 面板。
 */
export function TurnChangesCardView({ toolCallIds }: { toolCallIds: string[] }) {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const setReviewOpen = usePaneChatStore((s) => s.setReviewOpen);
  const openWorkspaceFile = usePaneChatStore((s) => s.openWorkspaceFile);
  const cwd = usePaneChatStore((s) => s.cwd);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [revertState, setRevertState] = useState<'idle' | 'reverting' | 'done' | 'error'>('idle');
  const [revertError, setRevertError] = useState('');
  const [showAllFiles, setShowAllFiles] = useState(false);

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
          <button className="turn-changes-view" data-testid="turn-changes-view" onClick={() => setReviewOpen(true)}>
            {t('chat.turnChanges.viewChanges')}
          </button>
        </div>
        <span className="turn-changes-stats"><span className="turn-stat-add">+{changes.added}</span><span className="turn-stat-del">-{changes.deleted}</span></span>
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
            onClick={() => setReviewOpen(true)}
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
        {visibleFiles.map((file) => (
          <div className="turn-changes-file" data-testid="turn-changes-file" key={file.path}>
            <button
              className="turn-changes-path"
              data-testid="turn-changes-open-file"
              title={t('chat.turnChanges.openFile')}
              aria-label={t('chat.turnChanges.openFile')}
              onClick={() => openWorkspaceFile(file.path)}
            >
              {displayPath(file.path)}
            </button>
            <span className="turn-stat-add">+{file.added}</span>
            <span className="turn-stat-del">-{file.deleted}</span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <button className="turn-changes-more" data-testid="turn-changes-more" onClick={() => setShowAllFiles(true)}>
            {t('chat.turnChanges.showMore', { count: hiddenCount })}<ChevronDown size={14} />
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
