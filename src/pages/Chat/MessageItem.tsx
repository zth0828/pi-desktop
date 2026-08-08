import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '../../components/Markdown';
import { useChatStore, type ChatMessage, type ContentBlock } from '../../stores/chat';
import { ToolCallCard } from './ToolCallCard';

function AssistantBlock({ block, streaming }: { block: ContentBlock; streaming?: boolean }) {
  const { t } = useTranslation();
  const toolExecutions = useChatStore((s) => s.toolExecutions);

  if (block.type === 'text') {
    return <Markdown text={block.text ?? ''} streaming={streaming} />;
  }
  if (block.type === 'thinking') {
    return (
      <details className={`thinking-block${streaming ? ' streaming' : ''}`}>
        <summary>{streaming ? t('chat.thinkingStreaming') : t('chat.thinkingDone')}</summary>
        <pre>{block.thinking}</pre>
      </details>
    );
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

export function MessageItem({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  if (message.role === 'user') {
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    const images = message.content.filter((b) => b.type === 'image');
    return (
      <div className="message message-user" data-testid="message-user">
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
        <AssistantBlock key={i} block={block} streaming={message.streaming} />
      ))}
      {message.streaming && <span className="cursor-blink">▍</span>}
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
