import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '../../lib/host-api';
import { collectTurnChanges } from '../../lib/turn-changes';
import { useChatStore } from '../../stores/chat';

/**
 * 聚合编辑卡（Codex「已编辑 N 个文件 +x -y」范式）：一轮对话结束后在该轮尾部展示
 * 成功的 edit/write 汇总。「撤销」仅 git 可用时出现（review baseline 回滚，
 * 语义 = 回到会话开始时的状态）；「审核」打开 Review 面板。
 */
export function TurnChangesCard({ toolCallIds }: { toolCallIds: string[] }) {
  const { t } = useTranslation();
  const toolExecutions = useChatStore((s) => s.toolExecutions);
  const setReviewOpen = useChatStore((s) => s.setReviewOpen);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [revertState, setRevertState] = useState<'idle' | 'reverting' | 'done' | 'error'>('idle');
  const [revertError, setRevertError] = useState('');

  const changes = collectTurnChanges(toolExecutions, toolCallIds);

  useEffect(() => {
    let alive = true;
    hostApi.review
      .getSummary()
      .then((summary) => {
        if (alive) setGitAvailable(summary.available);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (changes.files.length === 0) return null;

  const revertAll = async () => {
    setRevertState('reverting');
    for (const file of changes.files) {
      const result = await hostApi.review.revertFile(file.path);
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
        <span className="turn-changes-title" data-testid="turn-changes-title">
          {t('chat.turnChanges.title', { count: changes.files.length })}
        </span>
        <span className="turn-changes-stats">
          <span className="turn-stat-add">+{changes.added}</span>
          <span className="turn-stat-del">-{changes.deleted}</span>
        </span>
        <span className="turn-changes-actions">
          {gitAvailable && revertState !== 'done' && (
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
        {changes.files.map((file) => (
          <div className="turn-changes-file" data-testid="turn-changes-file" key={file.path}>
            <span className="turn-changes-path">{file.path}</span>
            <span className="turn-stat-add">+{file.added}</span>
            <span className="turn-stat-del">-{file.deleted}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
