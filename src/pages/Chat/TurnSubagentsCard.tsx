import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ExternalLink } from 'lucide-react';
import { isSubagentTool, extractSubagentSubTasks } from '../../lib/subagent-tool';
import { formatDuration } from '../../lib/tool-display';
import type { ToolExecution } from '../../stores/chat';
import { usePaneChatStore } from './chat-store-context';
import { SubagentCard } from './workbench/SubagentsTab';

export function TurnSubagentsCardView({ toolCallIds }: { toolCallIds: string[] }) {
  const { t } = useTranslation();
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const openWorkbenchTab = usePaneChatStore((s) => s.openWorkbenchTab);

  const subagentExecutions = useMemo(() => {
    const list: ToolExecution[] = [];
    for (const id of toolCallIds) {
      const ex = toolExecutions[id];
      if (ex && isSubagentTool(ex.toolName)) {
        list.push(ex);
      }
    }
    return list;
  }, [toolCallIds, toolExecutions]);

  const items = useMemo(() => {
    return subagentExecutions.flatMap((ex) => {
      const tasks = extractSubagentSubTasks(ex);
      const duration = formatDuration(ex.startedAt, ex.endedAt);
      return tasks.map((task) => ({
        task,
        toolCallId: ex.toolCallId,
        toolName: ex.toolName,
        duration,
      }));
    });
  }, [subagentExecutions]);

  if (items.length === 0) return null;

  const runningCount = items.filter((item) => item.task.status === 'running').length;

  return (
    <div className="turn-subagents" data-testid="turn-subagents-card">
      <div className="turn-subagents-header">
        <div className="turn-subagents-title-group">
          <Bot size={14} className="turn-subagents-bot-icon" />
          <span className="turn-subagents-title" data-testid="turn-subagents-title">
            {t('chat.turnSubagents.title', { count: items.length })}
          </span>
          {runningCount > 0 && (
            <span className="turn-subagents-running-badge" data-testid="turn-subagents-running-badge">
              <span className="subagent-spinner" />
              <span>{t('chat.turnSubagents.runningCount', { count: runningCount })}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="turn-subagents-view"
          data-testid="turn-subagents-open-workbench"
          title={t('chat.turnSubagents.viewInWorkbench')}
          onClick={() => openWorkbenchTab('subagents')}
        >
          <ExternalLink size={12} />
          <span>{t('chat.turnSubagents.viewInWorkbench')}</span>
        </button>
      </div>

      <div className="turn-subagents-items">
        {items.map(({ task, toolCallId, toolName, duration }) => (
          <SubagentCard
            key={task.id}
            task={task}
            toolCallId={toolCallId}
            toolName={toolName}
            parentDuration={duration}
            onOpenWorkbench={() => openWorkbenchTab('subagents')}
          />
        ))}
      </div>
    </div>
  );
}

export const TurnSubagentsCard = memo(TurnSubagentsCardView);
