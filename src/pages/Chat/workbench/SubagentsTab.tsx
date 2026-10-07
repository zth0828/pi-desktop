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
  formatToolArgs,
  isSubagentTool,
} from '../../../lib/subagent-tool';
import { usePaneChatStore } from '../chat-store-context';

export type SubagentFilter = 'all' | 'running' | 'completed' | 'failed';

export function SubagentsTab() {
  const { t } = useTranslation();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);

  const [filter, setFilter] = useState<SubagentFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
            const duration = formatDuration(item.startedAt, item.endedAt);
            const hasArgs = Boolean(item.args && typeof item.args === 'object' && Object.keys(item.args).length > 0);

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
                    {hasArgs && (
                      <div className="subagent-section">
                        <div className="subagent-section-title">{t('chat.tool.parameters')}</div>
                        <pre className="subagent-args-block custom-scroll font-mono">
                          {formatToolArgs(item.args)}
                        </pre>
                      </div>
                    )}

                    {(progress.outputText || isRunning) && (
                      <div className="subagent-section">
                        <div className="subagent-section-bar">
                          <span className="subagent-section-title">
                            {isRunning ? t('chat.tool.partialOutput') : t('chat.tool.result')}
                          </span>
                          {progress.outputText && (
                            <button
                              type="button"
                              className="subagent-copy-btn"
                              onClick={(e) => handleCopy(progress.outputText, item.toolCallId, e)}
                            >
                              {copiedId === item.toolCallId ? <Check size={11} /> : <Copy size={11} />}
                              <span>
                                {copiedId === item.toolCallId
                                  ? t('workspace.commandsCopied')
                                  : t('workspace.commandsCopyOutput')}
                              </span>
                            </button>
                          )}
                        </div>
                        <pre className="subagent-output-block custom-scroll font-mono" data-testid="subagent-output">
                          {progress.outputText || ''}
                          {isRunning && <span className="cursor-blink">▍</span>}
                        </pre>
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
