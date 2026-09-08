import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  ExternalLink,
  FileCode,
  FileText,
  Search,
  Terminal,
} from 'lucide-react';
import { cleanBashCommand, toolSummary } from '../../lib/tool-display';
import { usePaneChatStore } from './chat-store-context';

export interface RunningTaskItem {
  id: string;
  toolName: string;
  summary: string;
}

function getTaskIcon(toolName: string) {
  switch (toolName) {
    case 'bash':
      return <Terminal size={12} className="running-task-icon" />;
    case 'edit':
    case 'write':
      return <FileCode size={12} className="running-task-icon" />;
    case 'read':
      return <FileText size={12} className="running-task-icon" />;
    case 'grep':
    case 'find':
      return <Search size={12} className="running-task-icon" />;
    default:
      return <Terminal size={12} className="running-task-icon" />;
  }
}

export function RunningTasksCard() {
  const { t } = useTranslation();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const bashDraft = usePaneChatStore((s) => s.bashDraft);
  const isStreaming = usePaneChatStore((s) => s.isStreaming);
  const isRunning = usePaneChatStore((s) => s.running);
  const openWorkbenchTab = usePaneChatStore((s) => s.openWorkbenchTab);

  const [collapsed, setCollapsed] = useState(false);
  const [recentCompleted, setRecentCompleted] = useState<{
    toolName: string;
    summary: string;
  } | null>(null);

  const prevCountRef = useRef(0);
  const lastTaskRef = useRef<RunningTaskItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 收集所有正在运行中的任务（支持 bash 命令、文件读写、检索及用户运行中的 bashDraft）
  const runningTasks = useMemo<RunningTaskItem[]>(() => {
    const list: RunningTaskItem[] = [];

    if (bashDraft?.command) {
      list.push({
        id: 'user-bash-draft',
        toolName: 'bash',
        summary: cleanBashCommand(bashDraft.command),
      });
    }

    for (const [id, execution] of Object.entries(toolExecutions)) {
      if (execution.status === 'running') {
        const toolName = execution.toolName;
        let summary = toolSummary(toolName, execution.args) ?? toolName;
        if (toolName === 'bash') {
          const rawCmd = (execution.args as { command?: unknown } | undefined)?.command;
          if (typeof rawCmd === 'string' && rawCmd.trim()) {
            summary = cleanBashCommand(rawCmd);
          }
        }
        list.push({
          id,
          toolName,
          summary,
        });
      }
    }

    return list;
  }, [toolExecutions, bashDraft]);

  const count = runningTasks.length;

  // 记录最近一个执行的任务，用于完成时的短暂反馈
  if (count > 0) {
    lastTaskRef.current = runningTasks[0];
  }

  // 仅在 count 变化时管理完成态定时器，避免因流式 token 刷新导致定时器被异常重置
  useEffect(() => {
    if (count === 0 && prevCountRef.current > 0 && lastTaskRef.current) {
      const finished = lastTaskRef.current;
      setRecentCompleted({
        toolName: finished.toolName,
        summary: finished.summary,
      });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setRecentCompleted(null);
        timerRef.current = null;
      }, 2000);
    } else if (count > 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setRecentCompleted(null);
    }
    prevCountRef.current = count;
  }, [count]);

  // 当整个回合彻底结束时（非流式且非 running），确保在 1.5 秒内清理完成态并收起卡片
  useEffect(() => {
    if (!isStreaming && !isRunning && count === 0 && recentCompleted) {
      const exitTimer = setTimeout(() => {
        setRecentCompleted(null);
      }, 1500);
      return () => clearTimeout(exitTimer);
    }
  }, [isStreaming, isRunning, count, recentCompleted]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 没有运行中的任务，且没有处于完成态的暂留时，完全不占位
  if (count === 0 && !recentCompleted) {
    return null;
  }

  const isCompletedState = count === 0 && recentCompleted !== null;
  const primaryItem = isCompletedState
    ? recentCompleted
    : runningTasks[0];

  const handleOpenCommands = (e: React.MouseEvent) => {
    e.stopPropagation();
    openWorkbenchTab('commands');
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => !prev);
  };

  return (
    <div
      className={`running-tasks-card${isCompletedState ? ' completed' : ''}${collapsed ? ' collapsed' : ''}`}
      data-testid="running-tasks-card"
    >
      <div
        className="running-tasks-header"
        onClick={toggleCollapsed}
        title={collapsed ? t('chat.tasks.expand') : t('chat.tasks.collapse')}
      >
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
          {!isCompletedState && (
            <button
              type="button"
              className="running-tasks-chevron-btn"
              data-testid="running-tasks-toggle"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed();
              }}
              aria-label={collapsed ? t('chat.tasks.expand') : t('chat.tasks.collapse')}
              title={collapsed ? t('chat.tasks.expand') : t('chat.tasks.collapse')}
            >
              <ChevronDown
                size={14}
                className={`running-tasks-chevron${collapsed ? ' collapsed' : ' expanded'}`}
              />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="running-tasks-content">
          {!isCompletedState && count > 1 ? (
            <div className="running-tasks-list">
              {runningTasks.map((task) => (
                <div
                  key={task.id}
                  className="running-task-line"
                  onClick={handleOpenCommands}
                  title={task.summary}
                >
                  {getTaskIcon(task.toolName)}
                  <span className="running-task-cmd font-mono">{task.summary}</span>
                </div>
              ))}
            </div>
          ) : (
            primaryItem && (
              <div
                className="running-task-line"
                onClick={handleOpenCommands}
                title={primaryItem.summary}
              >
                {getTaskIcon(primaryItem.toolName)}
                <span className="running-task-cmd font-mono">{primaryItem.summary}</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
