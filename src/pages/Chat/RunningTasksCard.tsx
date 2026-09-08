import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ExternalLink, Terminal } from 'lucide-react';
import { usePaneChatStore } from './chat-store-context';

export interface RunningTaskItem {
  id: string;
  command: string;
}

export function RunningTasksCard() {
  const { t } = useTranslation();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const bashDraft = usePaneChatStore((s) => s.bashDraft);
  const openWorkbenchTab = usePaneChatStore((s) => s.openWorkbenchTab);

  const [expanded, setExpanded] = useState(false);
  const [recentCompleted, setRecentCompleted] = useState<{
    command: string;
    isError?: boolean;
  } | null>(null);

  const prevTasksCountRef = useRef(0);
  const lastTaskRef = useRef<RunningTaskItem | null>(null);
  const timerRef = useRef<number | null>(null);

  // 收集所有正在运行的 bash 命令（包含 agent tool 与 user bashDraft）
  const runningTasks = useMemo<RunningTaskItem[]>(() => {
    const list: RunningTaskItem[] = [];

    if (bashDraft?.command) {
      list.push({
        id: 'user-bash-draft',
        command: bashDraft.command,
      });
    }

    for (const [id, execution] of Object.entries(toolExecutions)) {
      if (execution.status === 'running' && execution.toolName === 'bash') {
        const cmd = (execution.args as { command?: unknown } | undefined)?.command;
        if (typeof cmd === 'string' && cmd.trim()) {
          list.push({ id, command: cmd });
        }
      }
    }

    return list;
  }, [toolExecutions, bashDraft]);

  const count = runningTasks.length;

  // 跟踪从 running 状态到完成状态的过渡，维持 2 秒完成提示
  useEffect(() => {
    if (count > 0) {
      lastTaskRef.current = runningTasks[0];
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setRecentCompleted(null);
    } else if (prevTasksCountRef.current > 0 && lastTaskRef.current) {
      // 刚从有任务变为 0 任务
      const last = lastTaskRef.current;
      setRecentCompleted({ command: last.command, isError: false });
      timerRef.current = window.setTimeout(() => {
        setRecentCompleted(null);
      }, 2200);
    }
    prevTasksCountRef.current = count;

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [count, runningTasks]);

  // 无运行中且无完成态暂留时，完全不渲染
  if (count === 0 && !recentCompleted) {
    return null;
  }

  const isCompletedState = count === 0 && recentCompleted !== null;
  const primaryCommand = isCompletedState
    ? recentCompleted.command
    : runningTasks[0]?.command ?? '';

  const handleOpenCommands = () => {
    openWorkbenchTab('commands');
  };

  return (
    <div
      className={`running-tasks-card${isCompletedState ? ' completed' : ''}`}
      data-testid="running-tasks-card"
    >
      <div className="running-tasks-header">
        <div className="running-tasks-title-wrap">
          {isCompletedState ? (
            <span className="running-tasks-done-icon">
              <Check size={12} strokeWidth={2.5} />
            </span>
          ) : (
            <span className="running-tasks-spinner" aria-hidden="true" />
          )}
          <span className="running-tasks-title">
            {isCompletedState
              ? t('chat.tasks.finished')
              : count === 1
                ? t('chat.tasks.running_one')
                : t('chat.tasks.running_other', { count })}
          </span>
        </div>

        <div className="running-tasks-actions">
          <button
            type="button"
            className="running-tasks-view-btn"
            data-testid="running-tasks-view-btn"
            onClick={handleOpenCommands}
            title={t('chat.tasks.viewInPanel')}
          >
            <ExternalLink size={12} />
            <span>{t('chat.tasks.viewInPanel')}</span>
          </button>
          {!isCompletedState && count > 1 && (
            <button
              type="button"
              className="running-tasks-chevron-btn"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? 'collapse' : 'expand'}
            >
              <ChevronDown
                size={14}
                className={`running-tasks-chevron${expanded ? ' expanded' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      <div className="running-tasks-content">
        {!isCompletedState && expanded && count > 1 ? (
          <div className="running-tasks-list">
            {runningTasks.map((task) => (
              <div
                key={task.id}
                className="running-task-line"
                onClick={handleOpenCommands}
                title={task.command}
              >
                <Terminal size={12} className="running-task-icon" />
                <span className="running-task-cmd font-mono">{task.command}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="running-task-line"
            onClick={handleOpenCommands}
            title={primaryCommand}
          >
            <Terminal size={12} className="running-task-icon" />
            <span className="running-task-cmd font-mono">{primaryCommand}</span>
          </div>
        )}
      </div>
    </div>
  );
}
