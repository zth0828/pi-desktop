import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collectToolWarnings,
  extractResultText,
  formatDuration,
  parseDiffLines,
  resultDetails,
  tailLines,
  toolSummary,
  type ToolWarning,
} from '../../lib/tool-display';
import { useChatStore, type ToolExecution } from '../../stores/chat';

/** 折叠态输出预览保留的尾部行数（pi bash 折叠态口径） */
const PREVIEW_LINES = 5;

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

export function ToolCallCard({ execution }: { execution: ToolExecution }) {
  const { t } = useTranslation();
  const toolsExpanded = useChatStore((s) => s.toolsExpanded);
  // null = 跟随全局开关；单独点击后为本地覆盖
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null);
  const expanded = localExpanded ?? toolsExpanded;

  const summary = toolSummary(execution.toolName, execution.args);
  const details = resultDetails(execution.result);
  const diff = typeof details?.diff === 'string' ? details.diff : undefined;
  const warnings = collectToolWarnings(details);
  const duration = formatDuration(execution.startedAt, execution.endedAt);
  const statusLabel = execution.interrupted
    ? t('chat.tool.interrupted')
    : t(`chat.tool.${execution.status}`);

  // 执行中显示流式 partialResult，完成后显示 result 文本
  const outputText =
    execution.status === 'running' && execution.partialResult !== undefined
      ? extractResultText(execution.partialResult)
      : extractResultText(execution.result);
  const preview = !expanded && !diff && outputText ? tailLines(outputText, PREVIEW_LINES) : null;

  return (
    <div className={`tool-card tool-${execution.status}`} data-testid="tool-card">
      <button className="tool-card-header" onClick={() => setLocalExpanded(!expanded)}>
        <span className="tool-name">{execution.toolName}</span>
        {summary ? <span className="tool-summary">{summary}</span> : <span className="spacer" />}
        {duration && <span className="tool-duration">{t('chat.tool.took', { duration })}</span>}
        <span className={`tool-status tool-status-${execution.status}`}>{statusLabel}</span>
      </button>

      {!expanded && diff && (
        <div className="tool-card-preview">
          <DiffView diff={diff} />
          <ToolWarnings warnings={warnings} />
        </div>
      )}
      {preview && (
        <div className="tool-card-preview">
          {preview.hidden > 0 && (
            <div className="tool-preview-more">{t('chat.tool.earlierLines', { count: preview.hidden })}</div>
          )}
          <pre>{preview.lines.join('\n')}</pre>
          <ToolWarnings warnings={warnings} />
        </div>
      )}

      {expanded && (
        <div className="tool-card-body">
          {execution.args !== undefined && (
            <>
              <div className="tool-section-title">{t('chat.tool.args')}</div>
              <pre>{JSON.stringify(execution.args, null, 2)}</pre>
            </>
          )}
          {(diff || outputText) && (
            <>
              <div className="tool-section-title">{t('chat.tool.result')}</div>
              {diff ? <DiffView diff={diff} /> : <pre>{outputText}</pre>}
            </>
          )}
          <ToolWarnings warnings={warnings} />
        </div>
      )}
    </div>
  );
}
