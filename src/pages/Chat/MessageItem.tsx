import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileText, GitFork } from 'lucide-react';
import { Markdown } from '../../components/Markdown';
import { CACHE_TTL_MS, formatTokenCount, type CacheMiss } from '../../lib/cache-stats';
import { formatDuration, formatWorkDuration } from '../../lib/tool-display';
import { hostApi } from '../../lib/host-api';
import { useChatStore, type ChatMessage, type ContentBlock } from '../../stores/chat';
import { ImageLightbox } from './ImageLightbox';
import { ToolCallCard } from './ToolCallCard';

/**
 * 「已处理 Xs」工作日志折叠的渲染指令（ChatPage 按逻辑轮计算后下发）：
 * hidden 里的工具卡不渲染；rows 命中的工具卡位置渲染折叠行（该轮第一个工具卡）。
 */
export type TurnFold = {
  hidden: Set<string>;
  rows: Map<string, { turn: number; count: number; startedAt?: number; endedAt?: number }>;
  onExpand: (turn: number) => void;
};

/** 折叠行：历史轮的工具卡序列收拢成「已处理 1m 28s ▸」，点击展开还原 */
function WorkLogRow({
  startedAt,
  endedAt,
  count,
  onExpand,
}: {
  startedAt?: number;
  endedAt?: number;
  count: number;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const duration = formatWorkDuration(startedAt, endedAt);
  return (
    <button className="work-log-row" data-testid="work-log-row" onClick={onExpand}>
      <span className="work-log-title">
        {duration
          ? t('chat.workLog.title', { count, duration })
          : t('chat.workLog.titleNoDuration', { count })}
      </span>
      <span className="work-log-chevron">▸</span>
    </button>
  );
}

/**
 * thinking 折叠块（Codex reasoningItem 范式）：流式中 "Thinking…"，
 * 结束后 "Thought for 3.2s"。计时时戳用 ref 记录（流式 partial 替换消息对象
 * 但组件实例随列表位置保持），历史消息没有计时时回退到通用完成文案。
 */
function ThinkingBlock({ thinking, active }: { thinking: string; active: boolean }) {
  const { t } = useTranslation();
  const startedRef = useRef<number | null>(null);
  const endedRef = useRef<number | null>(null);
  if (active && startedRef.current === null) startedRef.current = Date.now();
  if (!active && startedRef.current !== null && endedRef.current === null) endedRef.current = Date.now();
  const duration =
    startedRef.current !== null && endedRef.current !== null
      ? formatDuration(startedRef.current, endedRef.current)
      : null;
  return (
    <details className={`thinking-block${active ? ' streaming' : ''}`}>
      <summary>
        {active ? t('chat.thinkingStreaming') : duration ? t('chat.thinkingTimed', { duration }) : t('chat.thinkingDone')}
      </summary>
      <pre>{thinking}</pre>
    </details>
  );
}

function AssistantBlock({
  block,
  streaming,
  active,
  fold,
}: {
  block: ContentBlock;
  streaming?: boolean;
  active?: boolean;
  fold?: TurnFold;
}) {
  const toolExecutions = useChatStore((s) => s.toolExecutions);

  if (block.type === 'text') {
    return <Markdown text={block.text ?? ''} streaming={streaming} />;
  }
  if (block.type === 'thinking') {
    return <ThinkingBlock thinking={block.thinking ?? ''} active={active ?? false} />;
  }
  if (block.type === 'toolCall' && block.id) {
    // 历史轮折叠：该轮第一个工具卡位置渲染「已处理 Xs」行，其余工具卡隐藏
    if (fold) {
      const row = fold.rows.get(block.id);
      if (row) {
        return (
          <WorkLogRow
            startedAt={row.startedAt}
            endedAt={row.endedAt}
            count={row.count}
            onExpand={() => fold.onExpand(row.turn)}
          />
        );
      }
      if (fold.hidden.has(block.id)) return null;
    }
    const execution = toolExecutions[block.id] ?? {
      toolCallId: block.id,
      toolName: block.name ?? 'unknown',
      args: block.arguments,
      status: 'running' as const,
    };
    return <ToolCallCard execution={execution} />;
  }
  return null;
}

export function MessageItem({
  message,
  anchorId,
  cacheMiss,
  fold,
  processCollapsed = false,
}: {
  message: ChatMessage;
  anchorId?: string;
  /** 本轮 assistant 消息的缓存失效检测结果（collectCacheMisses 按下标分发） */
  cacheMiss?: CacheMiss;
  /** 工作日志折叠指令（仅 assistant 消息内的工具卡消费） */
  fold?: TurnFold;
  /** 已有最终答复时收起该轮的阶段文本，只在首个工具位置保留摘要行。 */
  processCollapsed?: boolean;
}) {
  const { t } = useTranslation();
  const forkFrom = useChatStore((s) => s.forkFrom);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [copied, setCopied] = useState<'text' | 'markdown' | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  if (message.role === 'user') {
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    const images = message.content.filter((b) => b.type === 'image');
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
        <div className="message-bubble">
          {images.map((b, i) => {
            // pi 的 ImageContent 是扁平 {data, mimeType}；兼容壳早期误存的 source 嵌套格式
            const block = b as { data?: string; mimeType?: string; source?: { mediaType?: string; data?: string } };
            const data = block.data ?? block.source?.data;
            const mimeType = block.mimeType ?? block.source?.mediaType;
            const url = data ? `data:${mimeType ?? 'image/png'};base64,${data}` : undefined;
            return url ? (
              <button className="message-image-button" key={i} onClick={() => setPreviewImage(url)}>
                <img className="message-image" data-testid="message-image" src={url} alt={t('chat.imagePreview')} />
              </button>
            ) : null;
          })}
          {text}
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
  const raw = message.raw as { stopReason?: string; errorMessage?: string } | undefined;
  const showTail = !message.streaming;
  const markdownText = message.content
    .filter((b) => b.type === 'text' || b.type === 'thinking')
    .map((b) => b.type === 'thinking' ? `> ${b.thinking ?? ''}` : b.text ?? '')
    .join('\n\n')
    .trim();
  const plainText = message.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (processCollapsed) {
    const summaryBlock = message.content.find((block) => block.type === 'toolCall' && block.id && fold?.rows.has(block.id));
    if (!summaryBlock) return null;
    return (
      <div className="message message-assistant message-process-summary" data-testid="message-assistant">
        <AssistantBlock block={summaryBlock} fold={fold} />
      </div>
    );
  }
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
      {message.content.map((block, i) => (
        <AssistantBlock
          key={i}
          block={block}
          streaming={message.streaming}
          active={Boolean(message.streaming) && i === message.content.length - 1}
          fold={fold}
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
    </div>
  );
}
