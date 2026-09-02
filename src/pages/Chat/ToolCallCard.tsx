import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronUp, Copy, Eye, Sparkles, Terminal } from 'lucide-react';
import {
  calculateDiffStats,
  collectToolWarnings,
  editPreviewDiff,
  extractResultText,
  formatDuration,
  parseDiffLines,
  previewPathFor,
  resultDetails,
  tailLines,
  toolSummary,
  type ToolWarning,
} from '../../lib/tool-display';
import type { ToolExecution } from '../../stores/chat';
import { FileIcon } from '../../components/FileIcon';
import { usePaneChatStore } from './chat-store-context';

function getSkillNameFromPath(filePath?: string): string | null {
  if (!filePath) return null;
  const match = filePath.match(/(?:^|[\\/])([a-zA-Z0-9_-]+)[\\/]SKILL\.md$/i);
  return match ? match[1] : null;
}

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
  const openReviewFile = usePaneChatStore((s) => s.openReviewFile);
  const cwd = usePaneChatStore((s) => s.cwd);

  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  const isRunning = execution.status === 'running';
  const isMutation = execution.toolName === 'edit' || execution.toolName === 'write';
  const isBash = execution.toolName === 'bash';

  // 流式中正在执行的项默认展开；完成后默认紧凑收起（跟随 expandByDefault）；单独点击后为本地覆盖
  const defaultExpanded = isRunning ? true : expandByDefault;
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null);
  const expanded = localExpanded ?? defaultExpanded;

  const rawCommand =
    execution.toolName === 'bash' && typeof execution.args === 'object' && execution.args !== null
      ? ((execution.args as { command?: string }).command ?? '')
      : undefined;

  const handleCopyCommand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (rawCommand && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(rawCommand);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    }
  };

  const handleCopyOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (outputText && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(outputText);
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    }
  };

  const summary = toolSummary(execution.toolName, execution.args);
  const details = resultDetails(execution.result);
  const realDiff = typeof details?.diff === 'string' ? details.diff : undefined;
  const previewDiff =
    !realDiff && execution.toolName === 'edit'
      ? editPreviewDiff(execution.args)
      : undefined;
  const diff = realDiff ?? previewDiff;

  const writeRaw = execution.toolName === 'write'
    ? (execution.args as { content?: unknown } | undefined)?.content
    : undefined;
  const writeContent = typeof writeRaw === 'string' && writeRaw.trim().length > 0 ? writeRaw : null;
  const warnings = collectToolWarnings(details);
  const duration = formatDuration(execution.startedAt, execution.endedAt);
  const statusLabel = execution.interrupted
    ? t('chat.tool.interrupted')
    : t(`chat.tool.${execution.status}`);

  const lineState = execution.interrupted ? 'stopped' : execution.status === 'running' ? 'running' : 'done';
  const verbTool = ['bash', 'edit', 'write', 'read', 'grep', 'find', 'ls'].includes(execution.toolName)
    ? execution.toolName
    : 'default';
  const line = t(`chat.tool.line.${verbTool}.${lineState}`, {
    tool: execution.toolName,
    summary: summary ?? execution.toolName,
    durationPart: duration && lineState === 'done' ? t('chat.tool.line.inDuration', { duration }) : '',
  });

  const outputText =
    execution.status === 'running' && execution.partialResult !== undefined
      ? extractResultText(execution.partialResult)
      : extractResultText(execution.result);
  const writeTail = !expanded && !diff && writeContent !== null
    ? tailLines(writeContent.trimEnd(), PREVIEW_LINES)
    : null;
  const writeTotalLines = writeTail ? writeTail.lines.length + writeTail.hidden : 0;
  const preview = !expanded && !diff && !isBash && writeContent === null && outputText ? tailLines(outputText, PREVIEW_LINES) : null;
  const previewPath = previewPathFor(execution.toolName, execution.args);
  const readPath =
    execution.toolName === 'read' && typeof execution.args === 'object' && execution.args !== null
      ? ((execution.args as { path?: string; file_path?: string }).path ??
         (execution.args as { file_path?: string }).file_path)
      : undefined;
  const skillName = getSkillNameFromPath(readPath);

  const normalizedCwd = cwd?.replace(/\\/g, '/').replace(/\/$/, '');
  const displayFilePath = previewPath
    ? normalizedCwd && previewPath.replace(/\\/g, '/').startsWith(`${normalizedCwd}/`)
      ? previewPath.replace(/\\/g, '/').slice(normalizedCwd.length + 1)
      : previewPath
    : summary ?? execution.toolName;

  const diffStats = calculateDiffStats(diff);
  const writeStats = writeContent !== null ? { added: writeContent.split('\n').length, deleted: 0 } : { added: 0, deleted: 0 };
  const stats = execution.toolName === 'write' ? writeStats : diffStats;
  const hasStats = isMutation && (stats.added > 0 || stats.deleted > 0);

  // 文件修改类工具：采用复合式文件条目头（支持点击文件名、点击数字、点击整行）
  if (isMutation && previewPath) {
    return (
      <div className={`tool-card tool-mutation tool-${execution.status}`} data-testid="tool-card">
        <div
          className="tool-card-file-row"
          data-testid="tool-file-row"
          onClick={() => setLocalExpanded(!expanded)}
        >
          <div className="tool-file-info">
            <FileIcon name={previewPath} size={14} />
            <button
              type="button"
              className="tool-file-name"
              data-testid="tool-open-file"
              title={t('chat.tool.previewFile')}
              onClick={(e) => {
                e.stopPropagation();
                openWorkspaceFile(previewPath);
              }}
            >
              {displayFilePath}
            </button>
          </div>
          <div className="tool-file-actions">
            {hasStats && (
              <button
                type="button"
                className="tool-stat-btn"
                data-testid="tool-stat-btn"
                title={t('chat.turnChanges.viewChanges')}
                onClick={(e) => {
                  e.stopPropagation();
                  openReviewFile(previewPath);
                }}
              >
                <span className="turn-stat-add">+{stats.added}</span>
                <span className="turn-stat-del">-{stats.deleted}</span>
              </button>
            )}
            <span className={`tool-status tool-status-${execution.status}`}>{statusLabel}</span>
            <span className="tool-chevron" data-testid="tool-chevron">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </div>
        </div>

        {expanded && (
          <div className="tool-card-body" data-testid="tool-card-body">
            <div className="tool-card-body-meta">
              <span className="tool-line">{line}</span>
              <button
                type="button"
                className="tool-file-preview"
                data-testid="tool-preview-file"
                title={t('chat.tool.previewFile')}
                aria-label={t('chat.tool.previewFile')}
                onClick={(e) => {
                  e.stopPropagation();
                  openWorkspaceFile(previewPath);
                }}
              >
                <Eye size={13} />
              </button>
            </div>
            {(realDiff || writeContent !== null || outputText) && (
              <>
                <div className="tool-section-title">{t('chat.tool.result')}</div>
                {realDiff ? (
                  <DiffView diff={realDiff} />
                ) : writeContent !== null ? (
                  <DiffView diff={contentToPseudoDiff(writeContent.trimEnd())} />
                ) : (
                  <pre>{outputText}</pre>
                )}
              </>
            )}
            <ToolWarnings warnings={warnings} />
          </div>
        )}
      </div>
    );
  }

  // 通用/终端/查看类工具
  return (
    <div className={`tool-card tool-${execution.status}`} data-testid="tool-card">
      <div className="tool-card-header-row">
        <button className="tool-card-header" onClick={() => setLocalExpanded(!expanded)}>
          <span className="tool-line" data-testid="tool-line">
            {skillName ? (
              <span className="tool-skill-badge" title={readPath}>
                <Sparkles size={12} className="tool-skill-sparkle" />
                {t('chat.tool.readingSkill', { name: skillName })}
              </span>
            ) : (
              line
            )}
          </span>
          <span className={`tool-status tool-status-${execution.status}`}>{statusLabel}</span>
          <span className="tool-chevron" data-testid="tool-chevron">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
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
        <div className={`tool-card-body${isBash ? ' tool-terminal-body' : ''}`} data-testid="tool-card-body">
          {isBash && (
            <div className="tool-terminal-header">
              <div className="tool-terminal-status">
                <span className={`tool-terminal-dot tool-terminal-dot-${execution.status}`} />
                <span className="tool-terminal-code">
                  {execution.status === 'running'
                    ? t('chat.tool.running')
                    : execution.status === 'error'
                      ? t('chat.tool.failed')
                      : t('chat.tool.success')}
                </span>
                {duration && <span className="tool-terminal-duration">({duration})</span>}
              </div>
            </div>
          )}

          {isBash && rawCommand && (
            <div className="tool-terminal-section">
              <div className="tool-terminal-section-bar">
                <span className="tool-terminal-section-title">$ {t('chat.tool.command')}</span>
                <button
                  type="button"
                  className="tool-terminal-copy-btn"
                  onClick={handleCopyCommand}
                  title={t('chat.tool.copyCommand')}
                >
                  {copiedCommand ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedCommand ? t('chat.tool.copied') : t('chat.tool.copyCommand')}</span>
                </button>
              </div>
              <pre className="tool-terminal-command custom-scroll">{rawCommand}</pre>
            </div>
          )}

          {isBash && outputText && (
            <div className="tool-terminal-section">
              <div className="tool-terminal-section-bar">
                <span className="tool-terminal-section-title">{t('chat.tool.output')}</span>
                <button
                  type="button"
                  className="tool-terminal-copy-btn"
                  onClick={handleCopyOutput}
                  title={t('chat.tool.copyOutput')}
                >
                  {copiedOutput ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedOutput ? t('chat.tool.copied') : t('chat.tool.copyOutput')}</span>
                </button>
              </div>
              <pre className="tool-terminal-output custom-scroll">{outputText}</pre>
            </div>
          )}

          {!isBash && (realDiff || writeContent !== null || outputText) && (
            <>
              <div className="tool-section-title">{t('chat.tool.result')}</div>
              {realDiff ? (
                <DiffView diff={realDiff} />
              ) : writeContent !== null ? (
                <DiffView diff={contentToPseudoDiff(writeContent.trimEnd())} />
              ) : (
                <pre>{outputText}</pre>
              )}
            </>
          )}

          <ToolWarnings warnings={warnings} />
        </div>
      )}
    </div>
  );
}
