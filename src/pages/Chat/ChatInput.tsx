import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ChevronDown, CircleGauge, Folder, Paperclip, Square } from 'lucide-react';
import type { PiCommandRow, PiModelRow, PiRuntimeContextUsage } from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import { useChatStore } from '../../stores/chat';

type StagedImage = { data: string; mediaType: string; previewUrl: string };

type ChatInputProps = {
  cwd: string;
  onChooseWorkspace: () => Promise<void>;
  onNewSession: () => void;
};

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

export function ChatInput({ cwd, onChooseWorkspace, onNewSession }: ChatInputProps) {
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
  const model = useChatStore((s) => s.model);
  const messages = useChatStore((s) => s.messages);
  const [models, setModels] = useState<PiModelRow[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [contextUsage, setContextUsage] = useState<PiRuntimeContextUsage | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (started) {
      void hostApi.piRuntime.getCommands().then((r) => setCommands(r.commands));
      void hostApi.providers.listModels().then((r) => setModels(r.models)).catch(() => {});
      const refreshUsage = () => {
        void hostApi.piRuntime.getContextUsage().then(setContextUsage).catch(() => setContextUsage(null));
      };
      refreshUsage();
      const timer = window.setInterval(refreshUsage, 1000);
      return () => window.clearInterval(timer);
    }
  }, [started]);

  useEffect(() => {
    if (model) setModelKey(`${model.provider}/${model.id}`);
  }, [model]);

  const usageTotals = messages.reduce(
    (totals, message) => {
      const usage = (message.raw as { usage?: Record<string, unknown> } | undefined)?.usage;
      if (!usage) return totals;
      return {
        input: totals.input + Number(usage.input ?? usage.prompt_tokens ?? 0),
        output: totals.output + Number(usage.output ?? usage.completion_tokens ?? 0),
        cacheRead: totals.cacheRead + Number(usage.cacheRead ?? 0),
        cacheWrite: totals.cacheWrite + Number(usage.cacheWrite ?? 0),
      };
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const selectedModel = models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelKey);
  const contextWindow = selectedModel?.contextWindow
    ?? (contextUsage?.contextWindow && contextUsage.contextWindow > 0 ? contextUsage.contextWindow : null);
  const contextPercent = contextUsage?.tokens != null && contextWindow
    ? (contextUsage.tokens / contextWindow) * 100
    : contextUsage?.percent;
  const contextLabel = contextUsage?.tokens == null || contextPercent == null
    ? t('chat.tokenUnknown')
    : `${Math.round(contextPercent)}%`;
  const formatTokens = (value: number | null | undefined) =>
    value == null ? t('chat.tokenUnknown') : value.toLocaleString();

  // / 补全面板：裸 '/' 只显示内置命令 + prompt 模板（skills 多，不打脸）；
  // 输入字符后再全量过滤，前缀匹配优先，built-in > prompt > skill 排序
  const query = value.startsWith('/') && !value.includes(' ') ? value.slice(1) : null;
  const sourceRank = (source: string) =>
    source === 'built-in' ? 0 : source.startsWith('prompt') ? 1 : 2;
  const matches = query === null
    ? []
    : commands
        .filter((c) => {
          if (query === '') return sourceRank(c.source) < 2;
          return c.name.toLowerCase().includes(query.toLowerCase());
        })
        .sort((a, b) => {
          const qa = query.toLowerCase();
          const pa = a.name.toLowerCase().startsWith(qa) ? 0 : 1;
          const pb = b.name.toLowerCase().startsWith(qa) ? 0 : 1;
          return pa - pb || sourceRank(a.source) - sourceRank(b.source) || a.name.localeCompare(b.name);
        })
        .slice(0, 8);
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
        <div className="chat-context-bar">
          <button
            className="context-chip workspace-chip"
            data-testid="chat-workspace"
            title={cwd}
            onClick={() => void onChooseWorkspace()}
          >
            <Folder size={15} />
            <span>{cwd.split('/').filter(Boolean).pop() ?? cwd}</span>
            <ChevronDown size={13} />
          </button>
          <span className="context-separator" aria-hidden="true" />
          {models.length > 0 ? (
            <select
              className="context-chip model-select"
              data-testid="model-select"
              aria-label={t('chat.model')}
              value={modelKey}
              onChange={(e) => {
                const previous = modelKey;
                const next = e.target.value;
                setModelKey(next);
                const [provider, ...rest] = e.target.value.split('/');
                void hostApi.piRuntime.setModel(provider, rest.join('/')).then(async (result) => {
                  if (!result.success) {
                    setModelKey(previous);
                    return;
                  }
                  const usage = await hostApi.piRuntime.getContextUsage();
                  setContextUsage(usage);
                });
              }}
            >
              {models.map((m) => (
                <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                  {m.name ?? m.id}
                </option>
              ))}
            </select>
          ) : model ? (
            <span className="context-chip model-badge" data-testid="model-badge">
              {model.name ?? model.id}
            </span>
          ) : null}
          <span className="spacer" />
          <button
            className="context-action"
            data-testid="new-session"
            onClick={onNewSession}
            disabled={isStreaming}
          >
            {t('chat.newSession')}
          </button>
        </div>
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
          <div className="usage-control">
            <button
              className="usage-button"
              data-testid="token-usage"
              aria-label={t('chat.tokenUsage')}
              aria-expanded={usageOpen}
              onClick={() => setUsageOpen((open) => !open)}
            >
              <CircleGauge size={17} />
              <span>{contextLabel}</span>
            </button>
            {usageOpen && (
              <div className="usage-popover" role="dialog" data-testid="token-usage-popover">
                <div className="usage-popover-title">{t('chat.tokenUsage')}</div>
                <div className="usage-row"><span>{t('chat.contextUsed')}</span><strong>{formatTokens(contextUsage?.tokens)}</strong></div>
                <div className="usage-row"><span>{t('chat.contextWindow')}</span><strong>{formatTokens(contextWindow)}</strong></div>
                <div className="usage-row"><span>{t('chat.inputTokens')}</span><strong>{formatTokens(usageTotals.input)}</strong></div>
                <div className="usage-row"><span>{t('chat.outputTokens')}</span><strong>{formatTokens(usageTotals.output)}</strong></div>
                {(usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && (
                  <>
                    <div className="usage-row"><span>{t('chat.cacheRead')}</span><strong>{formatTokens(usageTotals.cacheRead)}</strong></div>
                    <div className="usage-row"><span>{t('chat.cacheWrite')}</span><strong>{formatTokens(usageTotals.cacheWrite)}</strong></div>
                  </>
                )}
              </div>
            )}
          </div>
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
