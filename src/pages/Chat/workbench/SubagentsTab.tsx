import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Locate,
  Square,
} from 'lucide-react';
import { formatDuration } from '../../../lib/tool-display';
import {
  extractSubagentProgress,
  extractSubagentSubTasks,
  formatToolArgs,
  isSubagentTool,
  type SubagentSubTask,
} from '../../../lib/subagent-tool';
import { Markdown } from '../../../components/Markdown';
import { usePaneChatStore } from '../chat-store-context';

export type SubagentFilter = 'all' | 'running' | 'completed' | 'failed';

function SubTaskCard({
  task,
  copiedId,
  onCopy,
}: {
  task: SubagentSubTask;
  copiedId: string | null;
  onCopy: (text: string, id: string, e: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const taskCopyKey = `${task.id}-task`;
  const resultCopyKey = `${task.id}-result`;

  return (
    <div className={`subagent-task-card ${task.status}`} data-testid={`subtask-card-${task.id}`}>
      <div
        className="subagent-task-header"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <span className="subagent-task-chevron">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="subagent-task-agent-badge font-mono">{task.agent}</span>
        <span className="subagent-task-title" title={task.task}>
          {task.task.slice(0, 120) || t('workspace.subagentTask')}
        </span>
        <div className="subagent-task-header-meta">
          {task.actions.length > 0 && (
            <span className="subagent-task-actions-badge">
              {t('workspace.subagentActions', { count: task.actions.length })}
            </span>
          )}
          {task.usage?.total ? (
            <span className="subagent-task-usage-badge font-mono">
              {task.usage.total.toLocaleString()} tokens
            </span>
          ) : null}
          {task.status === 'running' && (
            <span className="subagent-status-badge running">
              <span className="subagent-spinner" />
              {t('workspace.subagentRunning')}
            </span>
          )}
          {task.status === 'success' && (
            <span className="subagent-status-badge success">
              <Check size={11} strokeWidth={2.5} />
            </span>
          )}
          {task.status === 'error' && (
            <span className="subagent-status-badge error">
              <AlertCircle size={11} />
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="subagent-task-body">
          {task.task && (
            <div className="subagent-task-desc-section">
              <div className="subagent-task-section-bar">
                <span className="subagent-task-section-label">{t('workspace.subagentTask')}</span>
                <button
                  type="button"
                  className="subagent-copy-btn"
                  onClick={(e) => onCopy(task.task, taskCopyKey, e)}
                  title={t('workspace.subagentCopyTask')}
                >
                  {copiedId === taskCopyKey ? <Check size={11} /> : <Copy size={11} />}
                  <span>
                    {copiedId === taskCopyKey ? t('workspace.subagentCopied') : t('workspace.subagentCopyTask')}
                  </span>
                </button>
              </div>
              <div className="subagent-task-desc-content">
                <Markdown text={task.task} />
              </div>
            </div>
          )}

          {task.actions.length > 0 && (
            <div className="subagent-task-trace-section">
              <div
                className="subagent-task-section-bar clickable"
                onClick={() => setTraceExpanded((v) => !v)}
              >
                <div className="subagent-task-section-left">
                  {traceExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="subagent-task-section-label">{t('workspace.subagentTrace')}</span>
                  <span className="subagent-task-trace-count">({task.actions.length})</span>
                </div>
              </div>
              {traceExpanded && (
                <div className="subagent-trace-list font-mono">
                  {task.actions.map((act) => (
                    <div key={act.id} className="subagent-trace-item" title={act.summary}>
                      <span className="subagent-trace-tool">{act.toolName}</span>
                      <span className="subagent-trace-summary">{act.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(task.output || task.status === 'running') && (
            <div className="subagent-task-result-section">
              <div className="subagent-task-section-bar">
                <span className="subagent-task-section-label">
                  {task.status === 'running' ? t('chat.tool.partialOutput') : t('workspace.subagentResult')}
                </span>
                {task.output && (
                  <button
                    type="button"
                    className="subagent-copy-btn"
                    onClick={(e) => onCopy(task.output, resultCopyKey, e)}
                    title={t('workspace.subagentCopyResult')}
                  >
                    {copiedId === resultCopyKey ? <Check size={11} /> : <Copy size={11} />}
                    <span>
                      {copiedId === resultCopyKey ? t('workspace.subagentCopied') : t('workspace.subagentCopyResult')}
                    </span>
                  </button>
                )}
              </div>
              <div className="subagent-task-result-content" data-testid="subagent-output">
                {task.output ? (
                  <Markdown text={task.output} />
                ) : (
                  <span className="cursor-blink">▍</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SubagentsTab() {
  const { t } = useTranslation();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);

  const [filter, setFilter] = useState<SubagentFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRawArgs, setShowRawArgs] = useState<Record<string, boolean>>({});

  // 收集所有子任务/subagent 工具执行记录，按开始时间倒序
  const allSubagents = useMemo(() => {
    return Object.values(toolExecutions)
      .filter((ex) => isSubagentTool(ex.toolName))
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }, [toolExecutions]);

  const runningCount = useMemo(
    () => allSubagents.filter((ex) => ex.status === 'running').length,
    [allSubagents],
  );

  const failedCount = useMemo(
    () => allSubagents.filter((ex) => ex.status === 'error' || ex.interrupted).length,
    [allSubagents],
  );

  const filteredSubagents = useMemo(() => {
    switch (filter) {
      case 'running':
        return allSubagents.filter((ex) => ex.status === 'running');
      case 'completed':
        return allSubagents.filter((ex) => ex.status === 'success');
      case 'failed':
        return allSubagents.filter((ex) => ex.status === 'error' || ex.interrupted);
      default:
        return allSubagents;
    }
  }, [allSubagents, filter]);

  const handleJumpToChat = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const el = document.getElementById(`tool-call-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash-highlight');
      setTimeout(() => el.classList.remove('flash-highlight'), 1500);
    }
  };

  const handleCopy = (text: string, id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!text || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="subagent-panel-container" data-testid="workbench-subagents-panel">
      <div className="subagent-toolbar">
        <div className="subagent-filter-group" role="tablist">
          <button
            type="button"
            className={`subagent-filter-btn${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('workspace.subagentFilterAll')}
            <span className="subagent-count-badge">{allSubagents.length}</span>
          </button>
          <button
            type="button"
            className={`subagent-filter-btn${filter === 'running' ? ' active' : ''}${runningCount > 0 ? ' has-running' : ''}`}
            onClick={() => setFilter('running')}
          >
            {t('workspace.subagentFilterRunning')}
            {runningCount > 0 && <span className="subagent-running-dot" />}
            <span className="subagent-count-badge">{runningCount}</span>
          </button>
          <button
            type="button"
            className={`subagent-filter-btn${filter === 'completed' ? ' active' : ''}`}
            onClick={() => setFilter('completed')}
          >
            {t('workspace.subagentFilterCompleted')}
          </button>
          <button
            type="button"
            className={`subagent-filter-btn${filter === 'failed' ? ' active' : ''}${failedCount > 0 ? ' has-failed' : ''}`}
            onClick={() => setFilter('failed')}
          >
            {t('workspace.subagentFilterFailed')}
            {failedCount > 0 && <span className="subagent-count-badge">{failedCount}</span>}
          </button>
        </div>
      </div>

      <div className="subagent-list custom-scroll" data-testid="subagent-list">
        {filteredSubagents.length === 0 ? (
          <div className="subagent-empty-state" data-testid="subagent-empty-state">
            <Bot size={36} className="subagent-empty-icon" />
            <div className="subagent-empty-title">{t('workspace.noSubagents')}</div>
            <div className="subagent-empty-desc">{t('workspace.noSubagentsDesc')}</div>
          </div>
        ) : (
          filteredSubagents.map((item) => {
            const isRunning = item.status === 'running';
            const isInterrupted = item.interrupted === true;
            const isError = item.status === 'error' && !isInterrupted;
            const isSuccess = item.status === 'success';
            const open = expandedId === item.toolCallId || isRunning;
            const progress = extractSubagentProgress(item);
            const subTasks = extractSubagentSubTasks(item);
            const duration = formatDuration(item.startedAt, item.endedAt);
            const hasArgs = Boolean(item.args && typeof item.args === 'object' && Object.keys(item.args).length > 0);
            const rawArgsVisible = showRawArgs[item.toolCallId] ?? false;

            return (
              <div
                key={item.toolCallId}
                className={`subagent-item${isRunning ? ' running' : ''}${isInterrupted ? ' interrupted' : ''}${isError ? ' error' : ''}`}
                data-testid={`subagent-item-${item.toolCallId}`}
              >
                <div
                  className="subagent-item-header"
                  data-testid="subagent-item-header"
                  onClick={() => setExpandedId(open && !isRunning ? null : item.toolCallId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId(open && !isRunning ? null : item.toolCallId);
                    }
                  }}
                >
                  <span className="subagent-item-chevron">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>

                  <span className="subagent-item-icon">
                    <Bot size={14} />
                  </span>

                  <div className="subagent-item-info">
                    <div className="subagent-item-top">
                      <span className="subagent-item-tool font-mono">{item.toolName}</span>
                      {progress.agentName && (
                        <span className="subagent-agent-tag">{progress.agentName}</span>
                      )}
                      <span className="subagent-item-summary">{progress.summary}</span>
                    </div>

                    {isRunning && progress.outputText && (
                      <div className="subagent-item-live-text font-mono" data-testid="subagent-live-text">
                        {progress.outputText}
                      </div>
                    )}
                  </div>

                  <div className="subagent-item-meta">
                    {isRunning && (
                      <span className="subagent-status-badge running" data-testid="subagent-status-running">
                        <span className="subagent-spinner" />
                        {t('workspace.subagentRunning')}
                      </span>
                    )}
                    {isSuccess && (
                      <span className="subagent-status-badge success" data-testid="subagent-status-success">
                        <Check size={11} strokeWidth={2.5} />
                        {t('workspace.subagentSuccess')}
                      </span>
                    )}
                    {isInterrupted && (
                      <span className="subagent-status-badge interrupted" data-testid="subagent-status-interrupted">
                        <Square size={11} />
                        {t('workspace.subagentInterrupted')}
                      </span>
                    )}
                    {isError && (
                      <span className="subagent-status-badge error" data-testid="subagent-status-error">
                        <AlertCircle size={11} />
                        {t('workspace.subagentError')}
                      </span>
                    )}

                    {duration && <span className="subagent-item-duration">{duration}</span>}

                    {isRunning && (
                      <button
                        type="button"
                        className="subagent-stop-btn"
                        disabled={true}
                        title={t('workspace.subagentAbortTooltip')}
                        aria-label={t('workspace.subagentAbortTooltip')}
                        data-testid="subagent-stop-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Square size={11} />
                        <span>{t('workspace.stopSubagent')}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="subagent-action-btn"
                      title={t('workspace.commandsJumpToChat')}
                      aria-label={t('workspace.commandsJumpToChat')}
                      onClick={(e) => handleJumpToChat(item.toolCallId, e)}
                    >
                      <Locate size={12} />
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="subagent-item-body">
                    {/* 结构化子任务卡片列表 */}
                    {subTasks.length > 0 && (
                      <div className="subagent-tasks-container">
                        <div className="subagent-tasks-header">
                          <span className="subagent-tasks-title">
                            {t('workspace.subagentTasks')} ({subTasks.length})
                          </span>
                        </div>
                        <div className="subagent-tasks-list">
                          {subTasks.map((task) => (
                            <SubTaskCard
                              key={task.id}
                              task={task}
                              copiedId={copiedId}
                              onCopy={handleCopy}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 原始参数折叠面板（便于排查底层调用） */}
                    {hasArgs && (
                      <div className="subagent-raw-args-section">
                        <div
                          className="subagent-raw-args-toggle"
                          onClick={() =>
                            setShowRawArgs((prev) => ({
                              ...prev,
                              [item.toolCallId]: !rawArgsVisible,
                            }))
                          }
                          role="button"
                          tabIndex={0}
                        >
                          {rawArgsVisible ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span>{t('chat.tool.parameters')}</span>
                        </div>
                        {rawArgsVisible && (
                          <pre className="subagent-args-block custom-scroll font-mono">
                            {formatToolArgs(item.args)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
