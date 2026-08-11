import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileText, GitFork } from 'lucide-react';
import { parseUserMessage } from '@shared/message-attachments';
import { Markdown } from '../../components/Markdown';
import { CACHE_TTL_MS, formatTokenCount, type CacheMiss } from '../../lib/cache-stats';
import { formatDuration } from '../../lib/tool-display';
import { hostApi } from '../../lib/host-api';
import { useChatStore, type ChatMessage, type ContentBlock, type TurnStats } from '../../stores/chat';
import { ImageLightbox } from './ImageLightbox';
import { ToolCallCard } from './ToolCallCard';

/**
 * thinking 折叠块（Codex reasoningItem 范式）：流式中 "Thinking…"，
 * 结束后 "Thought for 3.2s"。计时时戳用 ref 记录（流式 partial 替换消息对象
 * 但组件实例随列表位置保持），历史消息没有计时时回退到通用完成文案。
 */
function ThinkingBlock({ thinking, active, expanded, grouped }: { thinking: string; active: boolean; expanded?: boolean; grouped?: boolean }) {
  const { t } = useTranslation();
  const hiddenThinkingLabel = useChatStore((s) => s.extensionUi?.hiddenThinkingLabel);
  const startedRef = useRef<number | null>(null);
  const endedRef = useRef<number | null>(null);
  if (active && startedRef.current === null) startedRef.current = Date.now();
  if (!active && startedRef.current !== null && endedRef.current === null) endedRef.current = Date.now();
  const duration =
    startedRef.current !== null && endedRef.current !== null
      ? formatDuration(startedRef.current, endedRef.current)
      : null;
  if (grouped) return <div className="thinking-block grouped"><pre>{thinking}</pre></div>;
  return (
    <details className={`thinking-block${active ? ' streaming' : ''}`} open={expanded || active}>
      <summary>
        {active
          ? t('chat.thinkingStreaming')
          : !expanded && hiddenThinkingLabel
            ? hiddenThinkingLabel
            : duration
              ? t('chat.thinkingTimed', { duration })
              : t('chat.thinkingDone')}
      </summary>
      <pre>{thinking}</pre>
    </details>
  );
}

function AssistantBlock({
  block,
  streaming,
  active,
  expandThinking,
  expandTools,
  groupedThinking,
}: {
  block: ContentBlock;
  streaming?: boolean;
  active?: boolean;
  expandThinking?: boolean;
  expandTools?: boolean;
  groupedThinking?: boolean;
}) {
  const toolExecutions = useChatStore((s) => s.toolExecutions);

  if (block.type === 'text') {
    return <Markdown text={block.text ?? ''} streaming={streaming} />;
  }
  if (block.type === 'thinking') {
    return <ThinkingBlock thinking={block.thinking ?? ''} active={active ?? false} expanded={expandThinking} grouped={groupedThinking} />;
  }
  if (block.type === 'toolCall' && block.id) {
    const execution = toolExecutions[block.id] ?? {
      toolCallId: block.id,
      toolName: block.name ?? 'unknown',
      args: block.arguments,
      status: 'running' as const,
    };
    return <ToolCallCard execution={execution} expandByDefault={expandTools} />;
  }
  return null;
}

export function MessageItem({
  message,
  anchorId,
  cacheMiss,
  turnStats,
  contentOverride,
  expandThinking,
  expandTools,
  groupedThinking,
  suppressTail,
}: {
  message: ChatMessage;
  anchorId?: string;
  /** 本轮 assistant 消息的缓存失效检测结果（collectCacheMisses 按下标分发） */
  cacheMiss?: CacheMiss;
  /** 仅当前实时完成回合的收尾统计；恢复会话时为空。 */
  turnStats?: TurnStats | null;
  /** 回合折叠将最终答复与其他 block 分开渲染时使用。 */
  contentOverride?: ContentBlock[];
  /** 回合展开后 thinking 内容也同步展开。 */
  expandThinking?: boolean;
  /** 回合展开后工具结果也同步展开，避免嵌套折叠只显示尾部预览。 */
  expandTools?: boolean;
  /** 阶段容器已提供折叠控制时，thinking 直接内联，避免每段思考再套一层折叠。 */
  groupedThinking?: boolean;
  /** 最终 assistant 消息被拆成「过程 block」与「答复文本」时，尾部元数据只渲染一次。 */
  suppressTail?: boolean;
}) {
  const { t } = useTranslation();
  const forkFrom = useChatStore((s) => s.forkFrom);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [copied, setCopied] = useState<'text' | 'markdown' | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  if (message.role === 'user') {
    const rawText = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    const parsed = parseUserMessage(rawText);
    const images = message.content
      .filter((b) => b.type === 'image')
      .map((b) => {
        // pi 的 ImageContent 是扁平 {data, mimeType}；兼容壳早期误存的 source 嵌套格式
        const block = b as { data?: string; mimeType?: string; source?: { mediaType?: string; data?: string } };
        const data = block.data ?? block.source?.data;
        const mimeType = block.mimeType ?? block.source?.mediaType;
        return data ? `data:${mimeType ?? 'image/png'};base64,${data}` : null;
      });
    const usedImages = new Set<number>();
    const usedFiles = new Set<number>();
    const orderedAttachments: Array<
      | { kind: 'image'; index: number; name: string; url: string }
      | { kind: 'file'; index: number; name: string }
    > = [];
    for (const attachment of parsed.attachments) {
      if (attachment.kind === 'image') {
        const imageOffset = (attachment.imageIndex ?? 0) - 1;
        const url = images[imageOffset];
        if (!url) continue;
        usedImages.add(imageOffset);
        orderedAttachments.push({ kind: 'image', index: attachment.index, name: attachment.name, url });
        continue;
      }
      const fileOffset = parsed.files.findIndex((file, index) => file.name === attachment.name && !usedFiles.has(index));
      if (fileOffset < 0) continue;
      usedFiles.add(fileOffset);
      orderedAttachments.push({ kind: 'file', index: attachment.index, name: attachment.name });
    }
    // Older Pi Desktop sessions have no manifest. Keep all legacy attachments visible.
    let fallbackIndex = orderedAttachments.length;
    images.forEach((url, index) => {
      if (!url || usedImages.has(index)) return;
      fallbackIndex += 1;
      orderedAttachments.push({ kind: 'image', index: fallbackIndex, name: t('chat.imageNumber', { index: index + 1 }), url });
    });
    parsed.files.forEach((file, index) => {
      if (usedFiles.has(index)) return;
      fallbackIndex += 1;
      orderedAttachments.push({ kind: 'file', index: fallbackIndex, name: file.name });
    });
    return (
      <div className="message message-user" data-testid="message-user" id={anchorId}>
        {message.entryId && !isStreaming && (
          <button
            className="message-fork-btn"
            data-testid="fork-message"
            title={t('chat.forkFromHere')}
            onClick={() => void forkFrom(message.entryId!)}
          >
            <GitFork size={14} />
          </button>
        )}
        <div className="message-user-content">
          {orderedAttachments.length > 0 && (
            <div className="message-attachments" data-testid="message-attachments">
              {orderedAttachments.map((attachment) => attachment.kind === 'image' ? (
                <div className="message-attachment message-image-attachment" data-testid="message-attachment" data-attachment-index={attachment.index} key={`${attachment.index}-${attachment.name}`}>
                  <button className="message-image-button" onClick={() => setPreviewImage(attachment.url)} aria-label={t('chat.imageAttachment', { index: attachment.index, name: attachment.name })}>
                    <img className="message-image" data-testid="message-image" src={attachment.url} alt={attachment.name} />
                    <span className="attachment-order">{attachment.index}</span>
                  </button>
                  <span className="message-attachment-name" title={attachment.name}>{attachment.name}</span>
                </div>
              ) : (
                <div className="message-attachment message-file-attachment" data-testid="message-attachment" data-attachment-index={attachment.index} key={`${attachment.index}-${attachment.name}`}>
                  <span className="attachment-order">{attachment.index}</span>
                  <FileText size={18} />
                  <span className="message-attachment-name" data-testid="message-file" title={attachment.name}>{attachment.name}</span>
                </div>
              ))}
            </div>
          )}
          {parsed.text && <div className="message-bubble" data-testid="message-user-text">{parsed.text}</div>}
        </div>
        {previewImage && <ImageLightbox src={previewImage} onClose={() => setPreviewImage(null)} />}
      </div>
    );
  }
  if (message.role === 'toolResult') {
    return null; // 工具结果合并进 ToolCallCard 展示
  }
  if (message.role === 'compactionSummary') {
    // compaction 后刷新消息列表时 pi 带回的摘要消息（createCompactionSummaryMessage）
    const raw = message.raw as { summary?: string } | undefined;
    return (
      <details className="compaction-summary" data-testid="message-compaction">
        <summary>{t('chat.compactionSummary')}</summary>
        <Markdown text={raw?.summary ?? ''} />
      </details>
    );
  }
  const content = contentOverride ?? message.content;
  const raw = message.raw as { stopReason?: string; errorMessage?: string } | undefined;
  const showTail = !message.streaming && !suppressTail;
  const markdownText = content
    .filter((b) => b.type === 'text' || b.type === 'thinking')
    .map((b) => b.type === 'thinking' ? `> ${b.thinking ?? ''}` : b.text ?? '')
    .join('\n\n')
    .trim();
  const plainText = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (content.length === 0) return null;
  const copy = async (kind: 'text' | 'markdown') => {
    const value = kind === 'text' ? plainText : markdownText;
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else await hostApi.app.writeClipboard(value);
    } catch {
      await hostApi.app.writeClipboard(value);
    }
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1200);
  };
  return (
    <div className="message message-assistant" data-testid="message-assistant">
      {content.map((block, i) => (
        <AssistantBlock
          key={i}
          block={block}
          streaming={message.streaming}
          active={Boolean(message.streaming) && i === content.length - 1}
          expandThinking={expandThinking}
          expandTools={expandTools}
          groupedThinking={groupedThinking}
        />
      ))}
      {message.streaming && <span className="cursor-blink">▍</span>}
      {showTail && cacheMiss && (
        <div className="message-notice cache-miss" data-testid="cache-miss-notice">
          {t('chat.cache.miss', { tokens: formatTokenCount(cacheMiss.missedTokens) })}
          {cacheMiss.idleMs >= CACHE_TTL_MS &&
            ` ${t('chat.cache.missIdle', { minutes: Math.round(cacheMiss.idleMs / 60_000) })}`}
        </div>
      )}
      {showTail && raw?.stopReason === 'length' && (
        <div className="message-notice" data-testid="message-notice">
          {t('chat.stopLength')}
        </div>
      )}
      {showTail && raw?.errorMessage && (
        <div className="message-notice error" data-testid="message-error">
          {raw.errorMessage}
        </div>
      )}
      {showTail && plainText && (
        <div className="message-actions" data-testid="message-actions">
          <button data-testid="copy-message" title={t('chat.copy')} onClick={() => void copy('text')}>
            {copied === 'text' ? <Check size={13} /> : <Copy size={13} />} {copied === 'text' ? t('chat.copied') : t('chat.copy')}
          </button>
          <button data-testid="copy-markdown" title={t('chat.copyMarkdown')} onClick={() => void copy('markdown')}>
            <FileText size={13} /> {t('chat.copyMarkdown')}
          </button>
        </div>
      )}
      {showTail && plainText && turnStats && <TurnStatsCard stats={turnStats} />}
    </div>
  );
}

function TurnStatsCard({ stats }: { stats: TurnStats }) {
  const { t } = useTranslation();
  const totalTokens = stats.input + stats.output;
  const denominator = stats.input + stats.cacheRead + stats.cacheWrite;
  const hitRate = denominator > 0 ? Math.round((stats.cacheRead / denominator) * 100) : null;
  const totalSeconds = Math.max(0, Math.round(stats.durationMs / 1000));
  const duration = totalSeconds >= 60
    ? t('chat.turnStats.durationMinutes', { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 })
    : t('chat.turnStats.durationSeconds', { seconds: totalSeconds });
  const cost = stats.cost >= 1 ? stats.cost.toFixed(2) : stats.cost.toFixed(4);
  return (
    <div className="turn-stats-card" data-testid="turn-stats">
      <span
        data-testid="turn-stats-tokens"
        data-total={totalTokens}
        data-input={stats.input}
        data-output={stats.output}
      >{t('chat.turnStats.tokens', {
        tokens: totalTokens.toLocaleString(),
        input: stats.input.toLocaleString(),
        output: stats.output.toLocaleString(),
      })}</span>
      {hitRate != null && <span>{t('chat.turnStats.cache', { rate: hitRate })}</span>}
      <span>{duration}</span>
      {stats.cost > 0 && <span>{t('chat.turnStats.cost', { cost: `$${cost}` })}</span>}
    </div>
  );
}
