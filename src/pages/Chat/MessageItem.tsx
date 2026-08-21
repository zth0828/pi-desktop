import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileText, GitFork, Pencil } from 'lucide-react';
import { parseUserMessage } from '@shared/message-attachments';
import { parseProviderError } from '../../lib/provider-error';
import { Markdown } from '../../components/Markdown';
import { CACHE_TTL_MS, formatTokenCount, type CacheMiss } from '../../lib/cache-stats';
import { formatDuration } from '../../lib/tool-display';
import { hostApi } from '../../lib/host-api';
import type { ChatMessage, ContentBlock, TurnStats } from '../../stores/chat';
import { usePaneChatStore } from './chat-store-context';
import { ImageLightbox } from './ImageLightbox';
import { ToolCallCard } from './ToolCallCard';

/**
 * thinking 折叠块（Codex reasoningItem 范式）：流式中 "Thinking…"，
 * 结束后 "Thought for 3.2s"。计时时戳用 ref 记录（流式 partial 替换消息对象
 * 但组件实例随列表位置保持），历史消息没有计时时回退到通用完成文案。
 */
function ThinkingBlock({ thinking, active, expanded, grouped }: { thinking: string; active: boolean; expanded?: boolean; grouped?: boolean }) {
  const { t } = useTranslation();
  const hiddenThinkingLabel = usePaneChatStore((s) => s.extensionUi?.hiddenThinkingLabel);
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const startedRef = useRef<number | null>(null);
  const endedRef = useRef<number | null>(null);
  if (active && startedRef.current === null) startedRef.current = Date.now();
  if (!active && startedRef.current !== null && endedRef.current === null) endedRef.current = Date.now();
  const duration =
    startedRef.current !== null && endedRef.current !== null
      ? formatDuration(startedRef.current, endedRef.current)
      : null;
  if (grouped) return <div className="thinking-block grouped"><pre>{thinking}</pre></div>;
  const isOpen = userToggled ?? Boolean(expanded || active);
  return (
    <details
      className={`thinking-block${active ? ' streaming' : ''}`}
      open={isOpen}
      onToggle={(e) => {
        const target = e.currentTarget as HTMLDetailsElement;
        setUserToggled(target.open);
      }}
    >
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

/** 供应商错误提示：保留 pi 原文，按状态码/关键词附一条归属提示（谁的问题）。
 *  归属提示只在能识别时显示；识别不了的错误保持原样，避免误导。 */
function ErrorNotice({ message, responseId }: { message: string; responseId?: string }) {
  const { t } = useTranslation();
  const parsed = parseProviderError(message);
  const requestId = parsed.requestId ?? responseId;
  return (
    <div className="message-notice error" data-testid="message-error">
      <div className="error-message-raw">{message}</div>
      {parsed.category !== 'unknown' && (
        <div className="error-hint" data-testid={`error-hint-${parsed.category}`}>
          {t(`chat.errors.${parsed.category}`)}
          {requestId && (
            <span className="error-request-id"> {t('chat.errors.requestId', { id: requestId })}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** 工具调用块：只按 id 订阅本工具的执行记录；若整表订阅，任何工具进度事件都会
 *  重渲染所有消息的所有 block。 */
function ToolCallBlock({ block, expandTools }: { block: ContentBlock; expandTools?: boolean }) {
  const execution = usePaneChatStore((s) => (block.id ? s.toolExecutions[block.id] : undefined)) ?? {
    toolCallId: block.id ?? '',
    toolName: block.name ?? 'unknown',
    args: block.arguments,
    status: 'running' as const,
  };
  return <ToolCallCard execution={execution} expandByDefault={expandTools} />;
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
  if (block.type === 'text') {
    return <Markdown text={block.text ?? ''} streaming={streaming} />;
  }
  if (block.type === 'thinking') {
    return <ThinkingBlock thinking={block.thinking ?? ''} active={active ?? false} expanded={expandThinking} grouped={groupedThinking} />;
  }
  if (block.type === 'toolCall' && block.id) {
    return <ToolCallBlock block={block} expandTools={expandTools} />;
  }
  return null;
}

type MessageItemProps = {
  message: ChatMessage;
  anchorId?: string;
  /** 搜索跳转后的短暂定位反馈。 */
  highlighted?: boolean;
  /** 本轮 assistant 消息的缓存失效检测结果（collectCacheMisses 按下标分发） */
  cacheMiss?: CacheMiss;
  /** 仅当前实时完成回合的收尾统计；恢复会话时为空。 */
  turnStats?: TurnStats | null;
  /** 整个会话累计缓存命中率（0-1）；token 与耗时仍使用 turnStats 的本轮口径。 */
  sessionCacheHitRate?: number | null;
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
};

/** block 数组按元素引用比较（父组件 filter 产生新数组但元素引用稳定） */
function contentBlocksEqual(a?: ContentBlock[], b?: ContentBlock[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((block, i) => block === b[i]);
}

/** collectCacheMisses 每次重算产生新对象，按字段比较避免击穿 memo */
function cacheMissEqual(a?: CacheMiss, b?: CacheMiss): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.missedTokens === b.missedTokens
    && a.missedCost === b.missedCost
    && a.idleMs === b.idleMs
    && a.modelChanged === b.modelChanged;
}

/** memo 比较：message 引用不变 + 标量 props 相同即跳过重渲染；
 *  流式期间只有被替换的那条消息对象引用变化，其余消息整树跳过。 */
function messageItemPropsEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  return prev.message === next.message
    && prev.anchorId === next.anchorId
    && prev.highlighted === next.highlighted
    && cacheMissEqual(prev.cacheMiss, next.cacheMiss)
    && prev.turnStats === next.turnStats
    && prev.sessionCacheHitRate === next.sessionCacheHitRate
    && contentBlocksEqual(prev.contentOverride, next.contentOverride)
    && prev.expandThinking === next.expandThinking
    && prev.expandTools === next.expandTools
    && prev.groupedThinking === next.groupedThinking
    && prev.suppressTail === next.suppressTail;
}

function MessageItemView({
  message,
  anchorId,
  highlighted,
  cacheMiss,
  turnStats,
  sessionCacheHitRate,
  contentOverride,
  expandThinking,
  expandTools,
  groupedThinking,
  suppressTail,
}: MessageItemProps) {
  const { t } = useTranslation();
  const forkFrom = usePaneChatStore((s) => s.forkFrom);
  const editMessage = usePaneChatStore((s) => s.editMessage);
  const isStreaming = usePaneChatStore((s) => s.isStreaming);
  const [copied, setCopied] = useState(false);
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
      <div
        className={`message message-user${highlighted ? ' search-target' : ''}`}
        data-testid="message-user"
        id={anchorId}
        tabIndex={highlighted ? -1 : undefined}
      >
        {message.entryId && (
          <div className="message-user-actions">
            <button
              className="message-user-btn"
              data-testid="edit-message"
              title={t('chat.editMessage')}
              onClick={() => void editMessage(message.entryId!)}
            >
              <Pencil size={13} />
            </button>
            {!isStreaming && (
              <button
                className="message-user-btn message-fork-btn"
                data-testid="fork-message"
                title={t('chat.forkFromHere')}
                onClick={() => void forkFrom(message.entryId!)}
              >
                <GitFork size={13} />
              </button>
            )}
          </div>
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
    const raw = message.raw as { summary?: string; content?: string } | undefined;
    const summary = raw?.summary
      ?? raw?.content
      ?? message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();
    return (
      <details className="compaction-summary" data-testid="message-compaction" id={anchorId}>
        <summary>{t('chat.compactionSummary')}</summary>
        {summary && <Markdown text={summary} />}
      </details>
    );
  }
  if (message.role === 'bashExecution') {
    // `!` bash 执行结果（pi recordBashResult 落的消息）；streaming 草稿走同一卡片
    const rawBash = message.raw as {
      command?: string;
      output?: string;
      exitCode?: number;
      cancelled?: boolean;
      truncated?: boolean;
      excludeFromContext?: boolean;
    } | undefined;
    return (
      <div className="message message-bash" data-testid="message-bash">
        <div className="bash-header">
          <span className="bash-command" data-testid="bash-command">$ {rawBash?.command}</span>
          {rawBash?.excludeFromContext && (
            <span className="bash-badge">{t('chat.bash.excluded')}</span>
          )}
          {rawBash?.cancelled && <span className="bash-badge">{t('chat.bash.cancelled')}</span>}
          {rawBash?.exitCode !== undefined && (
            <span
              className={`bash-badge${rawBash.exitCode === 0 ? '' : ' error'}`}
              data-testid="bash-exit-code"
            >
              {t('chat.bash.exitCode', { code: rawBash.exitCode })}
            </span>
          )}
        </div>
        {rawBash?.output && (
          <pre className="bash-output" data-testid="bash-output">{rawBash.output}</pre>
        )}
        {message.streaming && <span className="cursor-blink">▍</span>}
      </div>
    );
  }
  const content = contentOverride ?? message.content;
  const raw = message.raw as { stopReason?: string; errorMessage?: string; responseId?: string } | undefined;
  const errorMessage = raw?.errorMessage;
  const showTail = !message.streaming && !suppressTail;
  const plainText = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  // 失败回合（stopReason=error）：只保留思考折叠块、过滤普通文本，末尾用
  // ErrorNotice 展示最终错误；content 为空时退化为仅 ErrorNotice。
  if (showTail && errorMessage) {
    const thinkingBlocks = content.filter((block) => block.type === 'thinking');
    return (
      <div
        className={`message message-assistant${highlighted ? ' search-target' : ''}`}
        data-testid="message-assistant"
        id={anchorId}
        tabIndex={highlighted ? -1 : undefined}
      >
        {thinkingBlocks.map((block, i) => (
          <AssistantBlock
            key={i}
            block={block}
            expandThinking={expandThinking}
            groupedThinking={false}
          />
        ))}
        <ErrorNotice message={errorMessage} responseId={raw?.responseId} />
      </div>
    );
  }
  // 无错误且 content 为空：没有可渲染内容，返回 null。
  if (content.length === 0) return null;
  const copy = async () => {
    if (!plainText) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(plainText);
      else await hostApi.app.writeClipboard(plainText);
    } catch {
      await hostApi.app.writeClipboard(plainText);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div
      className={`message message-assistant${highlighted ? ' search-target' : ''}`}
      data-testid="message-assistant"
      id={anchorId}
      tabIndex={highlighted ? -1 : undefined}
    >
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
      {showTail && plainText && (
        <div className="message-actions" data-testid="message-actions">
          <button data-testid="copy-message" title={t('chat.copy')} onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('chat.copied') : t('chat.copy')}
          </button>
        </div>
      )}
      {showTail && plainText && turnStats && (
        <TurnStatsCard stats={turnStats} sessionCacheHitRate={sessionCacheHitRate} />
      )}
    </div>
  );
}

// memo 化消息项——流式 chunk（合帧后）只重渲染正在变化的那条消息，
// 不再整表重渲染。props 引用稳定性由父组件（index.tsx map 处）与上面的自定义比较保证。
export const MessageItem = memo(MessageItemView, messageItemPropsEqual);

function TurnStatsCard({
  stats,
  sessionCacheHitRate,
}: {
  stats: TurnStats;
  sessionCacheHitRate?: number | null;
}) {
  const { t } = useTranslation();
  const totalTokens = stats.input + stats.output;
  const hitRate = sessionCacheHitRate == null ? null : Math.round(sessionCacheHitRate * 100);
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
