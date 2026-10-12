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
  Wrench,
} from 'lucide-react';
import { formatDuration } from '../../../lib/tool-display';
import {
  extractSubagentProgress,
  extractSubagentSubTasks,
  formatToolArgs,
  isSubagentTool,
  type SubagentActionTrace,
  type SubagentSubTask,
} from '../../../lib/subagent-tool';
import { Markdown } from '../../../components/Markdown';
import { usePaneChatStore } from '../chat-store-context';

export type SubagentFilter = 'all' | 'running' | 'completed' | 'failed';

/**
 * 内部单条工具调用的独立卡片组件（采用命令面板风格，支持点击展开查看入参与执行输出）。
 */
function InternalToolActionItem({
  action,
  copiedId,
  onCopy,
}: {
  action: SubagentActionTrace;
  copiedId: string | null;
  onCopy: (text: string, id: string, e: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const copyArgsKey = `${action.id}-args`;
  const copyOutputKey = `${action.id}-out`;

  const hasOutput = Boolean(action.output && action.output.trim());
  const hasArgs = Boolean(
    action.args && typeof action.args === 'object' && Object.keys(action.args).length > 0,
  );

  return (
    <div
      className={`internal-tool-item${open ? ' expanded' : ''}${action.isError ? ' error' : ''}`}
      data-testid={`internal-tool-${action.id}`}
    >
      <div
        className="internal-tool-header"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="internal-tool-chevron">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        <span className={`internal-tool-badge ${action.toolName}`}>
          {action.toolName}
        </span>

        <span className="internal-tool-summary font-mono" title={action.summary}>
          {action.summary}
        </span>

        <div className="internal-tool-meta">
          {action.isError ? (
            <span className="internal-tool-status-pill error">
              {t('workspace.subagentErrorStatus')}
            </span>
          ) : (
            <span className="internal-tool-status-pill success">
              {t('workspace.subagentSuccessStatus')}
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className="internal-tool-body">
          {hasArgs && (
            <div className="internal-tool-section">
              <div className="internal-tool-section-bar">
                <span className="internal-tool-section-label">{t('workspace.subagentToolParams')}</span>
                <button
                  type="button"
                  className="subagent-copy-btn"
                  onClick={(e) => onCopy(formatToolArgs(action.args), copyArgsKey, e)}
                  title={t('chat.copy')}
                >
                  {copiedId === copyArgsKey ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedId === copyArgsKey ? t('workspace.subagentCopied') : t('chat.copy')}</span>
                </button>
              </div>
              <pre className="internal-tool-code-block custom-scroll font-mono">
                {formatToolArgs(action.args)}
              </pre>
            </div>
          )}

          {hasOutput && (
            <div className="internal-tool-section">
              <div className="internal-tool-section-bar">
                <span className="internal-tool-section-label">{t('workspace.subagentToolOutput')}</span>
                <button
                  type="button"
                  className="subagent-copy-btn"
                  onClick={(e) => onCopy(action.output!, copyOutputKey, e)}
                  title={t('workspace.subagentCopyOutput')}
                >
                  {copiedId === copyOutputKey ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedId === copyOutputKey ? t('workspace.subagentCopied') : t('workspace.subagentCopyOutput')}</span>
                </button>
              </div>
              <pre className="internal-tool-code-block custom-scroll font-mono">
                {action.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 独立的 Subagent 顶级卡片（支持展开任务描述、结构化内部工具调用列表、Output Markdown 产出）。
 */
function SubagentCard({
  task,
  toolCallId,
  toolName,
  parentDuration,
  copiedId,
  onCopy,
  onJumpToChat,
}: {
  task: SubagentSubTask;
  toolCallId: string;
  toolName: string;
  parentDuration?: string | null;
  copiedId: string | null;
  onCopy: (text: string, id: string, e: MouseEvent) => void;
  onJumpToChat: (id: string, e: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [actionsExpanded, setActionsExpanded] = useState(!task.output);

  const taskCopyKey = `${task.id}-task`;
  const resultCopyKey = `${task.id}-result`;

  const isRunning = task.status === 'running';
  const isError = task.status === 'error';
  const isInterrupted = task.status === 'interrupted';
  const isSuccess = task.status === 'success';

  const expanded = userExpanded !== null ? userExpanded : isRunning;

  return (
    <div
      className={`subagent-card-item subagent-item${expanded ? ' expanded' : ''}${isRunning ? ' running' : ''}${isError ? ' error' : ''}${isInterrupted ? ' interrupted' : ''}`}
      data-testid={`subtask-card-${task.id}`}
    >
      {/* 头部：Agent - 名称 · Tokens · 耗时 · 状态 */}
      <div
        className="subagent-card-header subagent-item-header"
        data-testid="subagent-item-header"
        onClick={() => setUserExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setUserExpanded(!expanded);
          }
        }}
      >
        <span className="subagent-card-chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        <span className="subagent-card-icon">
          <Wrench size={13} />
        </span>

        <div className="subagent-card-title-group">
          <span className="subagent-card-agent-name font-mono">Agent - {task.agent}</span>
          {toolName && <span className="subagent-item-tool font-mono">{toolName}</span>}
          <span className="subagent-card-task-summary" title={task.task}>
            {task.task.slice(0, 90)}
          </span>
        </div>

        <div className="subagent-card-meta">
          {task.usage?.total ? (
            <span className="subagent-card-tokens font-mono">
              ~{(task.usage.total >= 1000 ? `${(task.usage.total / 1000).toFixed(1)}k` : task.usage.total)} tokens
            </span>
          ) : null}

          {parentDuration && (
            <span className="subagent-card-duration font-mono">{parentDuration}</span>
          )}

          {isRunning && (
            <span className="subagent-status-badge running" data-testid="subagent-status-running">
              <span className="subagent-spinner" />
              {t('workspace.subagentRunning')}
            </span>
          )}

          {isRunning && (
            <button
              type="button"
              className="subagent-stop-btn"
              disabled
              data-testid="subagent-stop-btn"
              title={t('workspace.subagentAbortTooltip')}
            >
              <Square size={10} />
              <span>{t('workspace.stopSubagent')}</span>
            </button>
          )}

          {isSuccess && (
            <span className="subagent-status-badge success" data-testid="subagent-status-success">
              <Check size={12} strokeWidth={2.5} />
            </span>
          )}

          {isInterrupted && (
            <span className="subagent-status-badge interrupted" data-testid="subagent-status-interrupted">
              {t('workspace.subagentInterrupted')}
            </span>
          )}

          {isError && (
            <span className="subagent-status-badge error" data-testid="subagent-status-error">
              <AlertCircle size={12} />
            </span>
          )}

          <button
            type="button"
            className="subagent-action-btn"
            title={t('workspace.commandsJumpToChat')}
            aria-label={t('workspace.commandsJumpToChat')}
            onClick={(e) => onJumpToChat(toolCallId, e)}
          >
            <Locate size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="subagent-card-body">
          {/* 失败错误输出提示 */}
          {task.stderr && (
            <div className="subagent-task-error-box font-mono" data-testid="subagent-task-error">
              <div className="subagent-task-error-title">
                <AlertCircle size={12} />
                <span>{t('workspace.subagentErrorDetails')}</span>
              </div>
              <pre>{task.stderr}</pre>
            </div>
          )}

          {/* 任务目标行（模仿截图 2 的 TASK Subagent 条目） */}
          {task.task && (
            <div className="subagent-card-task-row">
              <div className="subagent-card-task-left">
                <span className="subagent-task-pill-dot" />
                <span className="subagent-task-pill-tag">TASK</span>
                <span className="subagent-task-pill-name">{toolName || 'subagent'}</span>
              </div>
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
          )}

          {task.task && (
            <div className="subagent-card-task-desc custom-scroll">
              <Markdown text={task.task} />
            </div>
          )}

          {/* 内部工具执行卡片列表（对应截图 4 样式拆开展示） */}
          {task.actions.length > 0 && (
            <div className="subagent-internal-actions-container">
              <div
                className="subagent-internal-actions-header clickable"
                onClick={() => setActionsExpanded((v) => !v)}
              >
                <div className="subagent-internal-actions-title-wrap">
                  {actionsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="subagent-internal-actions-title">
                    {t('workspace.subagentActionsTitle')}
                  </span>
                  <span className="subagent-internal-actions-count">
                    ({task.actions.length})
                  </span>
                </div>
              </div>

              {actionsExpanded && (
                <div className="subagent-internal-actions-list">
                  {task.actions.map((act) => (
                    <InternalToolActionItem
                      key={act.id}
                      action={act}
                      copiedId={copiedId}
                      onCopy={onCopy}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 产出结果报告（对应截图 2 底部的 Output 卡片） */}
          {(task.output || isRunning) && (
            <div className="subagent-card-output-section">
              <div className="subagent-card-output-bar">
                <div className="subagent-card-output-title-wrap">
                  <span className="subagent-card-output-label">
                    {isRunning ? t('chat.tool.partialOutput') : t('workspace.subagentResult')}
                  </span>
                </div>
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

              <div className="subagent-card-output-content custom-scroll" data-testid="subagent-output">
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 收集所有子任务执行记录
  const allSubagents = useMemo(() => {
    return Object.values(toolExecutions)
      .filter((ex) => isSubagentTool(ex.toolName))
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }, [toolExecutions]);

  // 将所有 ToolExecution 下的子任务平铺为单独的 Subagent 记录
  interface FlattenedSubagent {
    task: SubagentSubTask;
    toolCallId: string;
    toolName: string;
    parentDuration?: string | null;
    startedAt: number;
    status: 'running' | 'success' | 'error' | 'interrupted';
  }

  const flattenedList: FlattenedSubagent[] = useMemo(() => {
    const list: FlattenedSubagent[] = [];
    for (const ex of allSubagents) {
      const subTasks = extractSubagentSubTasks(ex);
      const parentDuration = formatDuration(ex.startedAt, ex.endedAt);
      for (const st of subTasks) {
        list.push({
          task: st,
          toolCallId: ex.toolCallId,
          toolName: ex.toolName,
          parentDuration,
          startedAt: ex.startedAt ?? 0,
          status: st.status,
        });
      }
    }
    return list;
  }, [allSubagents]);

  const runningCount = useMemo(
    () => flattenedList.filter((item) => item.status === 'running').length,
    [flattenedList],
  );

  const failedCount = useMemo(
    () => flattenedList.filter((item) => item.status === 'error' || item.status === 'interrupted').length,
    [flattenedList],
  );

  const filteredList = useMemo(() => {
    switch (filter) {
      case 'running':
        return flattenedList.filter((item) => item.status === 'running');
      case 'completed':
        return flattenedList.filter((item) => item.status === 'success');
      case 'failed':
        return flattenedList.filter((item) => item.status === 'error' || item.status === 'interrupted');
      default:
        return flattenedList;
    }
  }, [flattenedList, filter]);

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
      {/* 顶部过滤工具栏 */}
      <div className="subagent-toolbar">
        <div className="subagent-filter-group" role="tablist">
          <button
            type="button"
            className={`subagent-filter-btn${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('workspace.subagentFilterAll')}
            <span className="subagent-count-badge">{flattenedList.length}</span>
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

      {/* 子任务独立记录列表 */}
      <div className="subagent-list custom-scroll" data-testid="subagent-list">
        {filteredList.length === 0 ? (
          <div className="subagent-empty-state" data-testid="subagent-empty-state">
            <Bot size={36} className="subagent-empty-icon" />
            <div className="subagent-empty-title">{t('workspace.noSubagents')}</div>
            <div className="subagent-empty-desc">{t('workspace.noSubagentsDesc')}</div>
          </div>
        ) : (
          filteredList.map((item) => (
            <SubagentCard
              key={item.task.id}
              task={item.task}
              toolCallId={item.toolCallId}
              toolName={item.toolName}
              parentDuration={item.parentDuration}
              copiedId={copiedId}
              onCopy={handleCopy}
              onJumpToChat={handleJumpToChat}
            />
          ))
        )}
      </div>
    </div>
  );
}
