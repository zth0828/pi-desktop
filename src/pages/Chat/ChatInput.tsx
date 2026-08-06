import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiCommandRow } from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import { useChatStore } from '../../stores/chat';

export function ChatInput() {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [commands, setCommands] = useState<PiCommandRow[]>([]);
  const [selected, setSelected] = useState(0);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const started = useChatStore((s) => s.started);
  const prompt = useChatStore((s) => s.prompt);
  const abort = useChatStore((s) => s.abort);
  const newSession = useChatStore((s) => s.newSession);
  const compact = useChatStore((s) => s.compact);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (started) {
      void hostApi.piRuntime.getCommands().then((r) => setCommands(r.commands));
    }
  }, [started]);

  // / 补全面板：输入以 / 开头时过滤
  const query = value.startsWith('/') && !value.includes(' ') ? value.slice(1) : null;
  const matches = query === null
    ? []
    : commands.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const panelOpen = matches.length > 0;

  const send = () => {
    const text = value.trim();
    if (!text) return;
    setValue('');
    // 壳内置命令直接执行，不发给 pi
    if (text === '/new') return void newSession();
    if (text === '/compact') return void compact();
    void prompt(text);
  };

  const pick = (cmd: PiCommandRow) => {
    if (cmd.source === 'built-in') {
      setValue('');
      if (cmd.name === 'new') void newSession();
      if (cmd.name === 'compact') void compact();
      return;
    }
    setValue(`/${cmd.name} `);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (panelOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && query !== '')) {
        e.preventDefault();
        pick(matches[selected] ?? matches[0]);
        return;
      }
      if (e.key === 'Escape') {
        setValue('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-input">
      {panelOpen && (
        <div className="command-panel" data-testid="command-panel">
          {matches.map((cmd, i) => (
            <button
              key={cmd.name}
              className={i === selected ? 'command-item selected' : 'command-item'}
              data-testid={`command-${cmd.name}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(cmd);
              }}
            >
              <span className="command-name">/{cmd.name}</span>
              <span className="command-desc">{cmd.description ?? ''}</span>
              <span className="command-source">{cmd.source}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        data-testid="chat-input"
        value={value}
        placeholder={t('chat.placeholder')}
        onChange={(e) => {
          setValue(e.target.value);
          setSelected(0);
        }}
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
