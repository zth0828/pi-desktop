import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chat';

export function ChatInput() {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const isStreaming = useChatStore((s) => s.isStreaming);
  const prompt = useChatStore((s) => s.prompt);
  const abort = useChatStore((s) => s.abort);

  const send = () => {
    const text = value.trim();
    if (!text) return;
    setValue('');
    void prompt(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-input">
      <textarea
        data-testid="chat-input"
        value={value}
        placeholder={t('chat.placeholder')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
      />
      {isStreaming ? (
        <button data-testid="chat-stop" className="danger" onClick={() => void abort()}>
          {t('chat.stop')}
        </button>
      ) : (
        <button data-testid="chat-send" className="primary" onClick={send} disabled={!value.trim()}>
          {t('chat.send')}
        </button>
      )}
    </div>
  );
}
