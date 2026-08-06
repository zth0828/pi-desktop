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
      <details className="thinking-block">
        <summary>{t('chat.thinking')}</summary>
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
  if (message.role === 'user') {
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    return (
      <div className="message message-user" data-testid="message-user">
        <div className="message-bubble">{text}</div>
      </div>
    );
  }
  if (message.role === 'toolResult') {
    return null; // 工具结果合并进 ToolCallCard 展示
  }
  return (
    <div className="message message-assistant" data-testid="message-assistant">
      {message.content.map((block, i) => (
        <AssistantBlock key={i} block={block} streaming={message.streaming} />
      ))}
      {message.streaming && <span className="cursor-blink">▍</span>}
    </div>
  );
}
