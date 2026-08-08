import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitFork } from 'lucide-react';
import { Markdown } from '../../components/Markdown';
import { CACHE_TTL_MS, formatTokenCount, type CacheMiss } from '../../lib/cache-stats';
import { formatDuration } from '../../lib/tool-display';
import { useChatStore, type ChatMessage, type ContentBlock } from '../../stores/chat';
import { ToolCallCard } from './ToolCallCard';

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
}: {
  block: ContentBlock;
  streaming?: boolean;
  active?: boolean;
}) {
  const toolExecutions = useChatStore((s) => s.toolExecutions);

  if (block.type === 'text') {
    return <Markdown text={block.text ?? ''} streaming={streaming} />;
  }
  if (block.type === 'thinking') {
    return <ThinkingBlock thinking={block.thinking ?? ''} active={active ?? false} />;
  }
  if (block.type === 'toolCall' && block.id) {
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
}: {
  message: ChatMessage;
  anchorId?: string;
  /** 本轮 assistant 消息的缓存失效检测结果（collectCacheMisses 按下标分发） */
  cacheMiss?: CacheMiss;
}) {
  const { t } = useTranslation();
  const forkFrom = useChatStore((s) => s.forkFrom);
  const isStreaming = useChatStore((s) => s.isStreaming);
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
            return url ? <img key={i} className="message-image" data-testid="message-image" src={url} alt="" /> : null;
          })}
          {text}
        </div>
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
  return (
    <div className="message message-assistant" data-testid="message-assistant">
      {message.content.map((block, i) => (
        <AssistantBlock
          key={i}
          block={block}
          streaming={message.streaming}
          active={Boolean(message.streaming) && i === message.content.length - 1}
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
    </div>
  );
}
