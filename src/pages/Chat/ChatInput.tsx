import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import type { PiCommandRow } from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import { useChatStore } from '../../stores/chat';

type StagedImage = { data: string; mediaType: string; previewUrl: string };

function fileToStagedImage(file: File): Promise<StagedImage> {
  return new Promise((resolveFile, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolveFile({
        data: dataUrl.split(',')[1] ?? '',
        mediaType: file.type || 'image/png',
        previewUrl: dataUrl,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatInput() {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [images, setImages] = useState<StagedImage[]>([]);
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
    if (!text && images.length === 0) return;
    const outgoing = images;
    setValue('');
    setImages([]);
    // 壳内置命令直接执行，不发给 pi
    if (text === '/new' && outgoing.length === 0) return void newSession();
    if (text === '/compact' && outgoing.length === 0) return void compact();
    void prompt(
      text,
      outgoing.map((img) => ({
        type: 'image',
        source: { type: 'base64', mediaType: img.mediaType, data: img.data },
      })),
    );
  };

  const stageFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const staged = await fileToStagedImage(file);
        setImages((prev) => [...prev, staged]);
      } catch {
        // 忽略读不了的文件
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void stageFiles(files);
    }
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
      <div className="chat-input-card">
        {images.length > 0 && (
          <div className="staged-images" data-testid="staged-images">
            {images.map((img, i) => (
              <span key={i} className="staged-image">
                <img src={img.previewUrl} alt="" />
                <button
                  className="staged-remove"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
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
          onPaste={onPaste}
          rows={3}
        />
        <div className="chat-input-toolbar">
          <label className="attach-button" data-testid="attach-image" title={t('chat.attachImage')}>
            <Paperclip size={16} />
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              data-testid="attach-input"
              onChange={(e) => {
                void stageFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
          <span className="spacer" />
          {isStreaming ? (
            <button data-testid="chat-stop" className="send-button stop" onClick={() => void abort()}>
              <Square size={13} />
            </button>
          ) : (
            <button
              data-testid="chat-send"
              className="send-button"
              onClick={send}
              disabled={!value.trim() && images.length === 0}
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
