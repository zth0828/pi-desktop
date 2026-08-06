import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolExecution } from '../../stores/chat';

function extractText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .filter(Boolean)
    .join('\n');
}

export function ToolCallCard({ execution }: { execution: ToolExecution }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const resultText = extractText(execution.result);

  return (
    <div className={`tool-card tool-${execution.status}`} data-testid="tool-card">
      <button className="tool-card-header" onClick={() => setExpanded((v) => !v)}>
        <span className="tool-name">{execution.toolName}</span>
        <span className={`tool-status tool-status-${execution.status}`}>
          {t(`chat.tool.${execution.status}`)}
        </span>
      </button>
      {expanded && (
        <div className="tool-card-body">
          {execution.args !== undefined && (
            <>
              <div className="tool-section-title">{t('chat.tool.args')}</div>
              <pre>{JSON.stringify(execution.args, null, 2)}</pre>
            </>
          )}
          {resultText && (
            <>
              <div className="tool-section-title">{t('chat.tool.result')}</div>
              <pre>{resultText.slice(0, 4000)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
