import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import {
  collectToolWarnings,
  editPreviewDiff,
  extractResultText,
  formatDuration,
  parseDiffLines,
  resultDetails,
  tailLines,
  toolSummary,
  type ToolWarning,
} from '../../lib/tool-display';
import type { ToolExecution } from '../../stores/chat';
import { usePaneChatStore } from './chat-store-context';

/** 折叠态输出预览保留的尾部行数（pi bash 折叠态口径） */
const PREVIEW_LINES = 5;

/** 带行号的文件内容视图：构造 pi diff 格式的 context 行（" <linenum> content"）复用 DiffView */
function contentToPseudoDiff(content: string, startLine = 1): string {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop(); // 末尾换行不多算一行
  return lines.map((line, i) => ` ${startLine + i} ${line}`).join('\n');
}

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

export function ToolCallCard({
  execution,
  expandByDefault = false,
}: {
  execution: ToolExecution;
  /** 外层回合已展开时同步展示完整结果；用户仍可点击本卡片单独覆盖。 */
  expandByDefault?: boolean;
}) {
  const { t } = useTranslation();
  const openWorkspaceFile = usePaneChatStore((s) => s.openWorkspaceFile);
  // null = 跟随阶段默认值；单独点击后为本地覆盖
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null);
  const expanded = localExpanded ?? expandByDefault;

  const summary = toolSummary(execution.toolName, execution.args);
  const details = resultDetails(execution.result);
  const realDiff = typeof details?.diff === 'string' ? details.diff : undefined;
  // edit 缺真实 diff 时按「整段替换」从 args 构造预览：执行中是流式预览，
  // 完成/恢复会话没有 details.diff 时同样兜底，而不是什么都不显示
  const previewDiff =
    !realDiff && execution.toolName === 'edit'
      ? editPreviewDiff(execution.args)
      : undefined;
  const diff = realDiff ?? previewDiff;
  // write 的内容在 args.content：预览/展开直接展示写入内容（带行号），
  // 比结果文本（"Wrote N bytes" 之类）有信息量
  const writeRaw = execution.toolName === 'write'
    ? (execution.args as { content?: unknown } | undefined)?.content
    : undefined;
  const writeContent = typeof writeRaw === 'string' && writeRaw.trim().length > 0 ? writeRaw : null;
  const warnings = collectToolWarnings(details);
  const duration = formatDuration(execution.startedAt, execution.endedAt);
  const statusLabel = execution.interrupted
    ? t('chat.tool.interrupted')
    : t(`chat.tool.${execution.status}`);

  // 动词化一行文案（Codex 范式）：进行/完成/中止三态成对，如
  // "Running command…" / "Ran $ ls in 1.2s" / "Stopped"；error 复用 done 模板（pill 标红）。
  const lineState = execution.interrupted ? 'stopped' : execution.status === 'running' ? 'running' : 'done';
  const verbTool = ['bash', 'edit', 'write', 'read', 'grep'].includes(execution.toolName)
    ? execution.toolName
    : 'default';
  const line = t(`chat.tool.line.${verbTool}.${lineState}`, {
    tool: execution.toolName,
    summary: summary ?? execution.toolName,
    durationPart: duration && lineState === 'done' ? t('chat.tool.line.inDuration', { duration }) : '',
  });

  // 执行中显示流式 partialResult，完成后显示 result 文本
  const outputText =
    execution.status === 'running' && execution.partialResult !== undefined
      ? extractResultText(execution.partialResult)
      : extractResultText(execution.result);
  const writeTail = !expanded && !diff && writeContent !== null
    ? tailLines(writeContent.trimEnd(), PREVIEW_LINES)
    : null;
  const writeTotalLines = writeTail ? writeTail.lines.length + writeTail.hidden : 0;
  const preview = !expanded && !diff && writeContent === null && outputText ? tailLines(outputText, PREVIEW_LINES) : null;
  const previewPath = ['read', 'edit', 'write'].includes(execution.toolName) ? summary : null;

  return (
    <div className={`tool-card tool-${execution.status}`} data-testid="tool-card">
      <div className="tool-card-header-row">
        <button className="tool-card-header" onClick={() => setLocalExpanded(!expanded)}>
          <span className="tool-line" data-testid="tool-line">{line}</span>
          <span className={`tool-status tool-status-${execution.status}`}>{statusLabel}</span>
        </button>
        {previewPath && (
          <button
            className="tool-file-preview"
            data-testid="tool-preview-file"
            title={t('chat.tool.previewFile')}
            aria-label={t('chat.tool.previewFile')}
            onClick={() => openWorkspaceFile(previewPath)}
          >
            <Eye size={14} />
          </button>
        )}
      </div>

      {!expanded && diff && (
        <div className="tool-card-preview" {...(previewDiff ? { 'data-testid': 'edit-diff-preview' } : {})}>
          <DiffView diff={diff} />
          <ToolWarnings warnings={warnings} />
        </div>
      )}
      {writeTail && (
        <div className="tool-card-preview" data-testid="write-content-preview">
          {writeTail.hidden > 0 && (
            <div className="tool-preview-more">{t('chat.tool.earlierLines', { count: writeTail.hidden })}</div>
          )}
          <DiffView diff={contentToPseudoDiff(writeTail.lines.join('\n'), writeTotalLines - writeTail.lines.length + 1)} />
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
        <div className="tool-card-body" data-testid="tool-card-body">
          {/* 对齐 Codex：参数 JSON 不展示（header 摘要已含命令/路径等关键信息），
              展开只看结果（输出/diff/写入内容） */}
          {(realDiff || writeContent !== null || outputText) && (
            <>
              <div className="tool-section-title">{t('chat.tool.result')}</div>
              {realDiff
                ? <DiffView diff={realDiff} />
                : writeContent !== null
                  ? <DiffView diff={contentToPseudoDiff(writeContent.trimEnd())} />
                  : <pre>{outputText}</pre>}
            </>
          )}
          <ToolWarnings warnings={warnings} />
        </div>
      )}
    </div>
  );
}
