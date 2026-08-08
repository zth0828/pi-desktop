import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ChevronDown, CircleGauge, Folder, Paperclip, Square } from 'lucide-react';
import type { PiCommandRow, PiModelRow, PiRuntimeContextUsage } from '@shared/host-api/contract';
import { formatFileBlock, isProbablyBinary, MAX_FILE_TEXT_BYTES } from '@shared/file-references';
import { hostApi } from '../../lib/host-api';
import { filterFiles } from '../../lib/file-search';
import { cacheHitRate, formatCost, formatHitRate, summarizeUsage } from '../../lib/usage-stats';
import { useChatStore } from '../../stores/chat';

type StagedImage = { data: string; mediaType: string; previewUrl: string };
type StagedFile = { name: string; text: string };

/** 光标处的 @ token（@ 前需行首/空白，对齐 pi-tui 编辑器触发规则） */
type AtToken = { start: number; end: number; query: string };

function detectAtToken(text: string, caret: number): AtToken | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|[\s])@([^\s@]*)$/);
  if (!m) return null;
  const query = m[1];
  return { start: before.length - query.length - 1, end: caret, query };
}

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
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [commands, setCommands] = useState<PiCommandRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [atToken, setAtToken] = useState<AtToken | null>(null);
  const [atSuppressed, setAtSuppressed] = useState(false);
  const [fileList, setFileList] = useState<string[]>([]);
  const [fileSelected, setFileSelected] = useState(0);
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

  const usageTotals = summarizeUsage(messages);
  const totalHitRate = cacheHitRate(usageTotals);
  const lastTurnHitRate = usageTotals.lastTurn ? cacheHitRate(usageTotals.lastTurn) : null;
  const selectedModel = models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelKey);
  // 模型下拉按供应商分组（optgroup），供应商顺序保持 listModels 的首现顺序
  const modelGroups = new Map<string, PiModelRow[]>();
  for (const m of models) {
    const group = modelGroups.get(m.provider);
    if (group) group.push(m);
    else modelGroups.set(m.provider, [m]);
  }
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

  // @ 文件补全：panel 打开时拉一次候选列表（cwd 下相对路径），本地模糊过滤
  const atActive = atToken !== null && !atSuppressed;
  useEffect(() => {
    if (!atActive) return;
    void hostApi.piFiles.list(cwd).then((r) => setFileList(r.files)).catch(() => {});
  }, [atActive, cwd]);
  const fileMatches = atActive ? filterFiles(fileList, atToken.query) : [];
  const filePanelOpen = fileMatches.length > 0;

  const send = () => {
    const text = value.trim();
    if (!text && images.length === 0 && stagedFiles.length === 0) return;
    const outgoing = images;
    // 附件文本文件：照 pi file-processor 的 <file name> 块前置于 prompt
    const filePrefix = stagedFiles.map((f) => formatFileBlock(f.name, f.text)).join('');
    setValue('');
    setImages([]);
    setStagedFiles([]);
    // 壳内置命令直接执行，不发给 pi
    if (text === '/new' && outgoing.length === 0 && stagedFiles.length === 0) return void newSession();
    if (text === '/compact' && outgoing.length === 0 && stagedFiles.length === 0) return void compact();
    void prompt(
      filePrefix + text,
      // pi ImageContent 是扁平结构 {type:'image', data, mimeType}
      outgoing.map((img) => ({ type: 'image', data: img.data, mimeType: img.mediaType })),
    );
  };

  const stageFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const staged = await fileToStagedImage(file);
          setImages((prev) => [...prev, staged]);
        } catch {
          // 忽略读不了的文件
        }
        continue;
      }
      // 文本文件：读内容暂存，发送时按 <file name> 块拼进 prompt（超大/二进制跳过）
      if (file.size > MAX_FILE_TEXT_BYTES) continue;
      try {
        const text = await file.text();
        if (isProbablyBinary(text)) continue;
        setStagedFiles((prev) => [...prev, { name: file.name, text }]);
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

  /** 选中文件：把光标处的 @query 替换为 @相对路径（含空格走 @"..." 引用，对齐 pi-tui） */
  const pickFile = (relPath: string) => {
    if (!atToken) return;
    const inserted = relPath.includes(' ') ? `@"${relPath}"` : `@${relPath}`;
    setValue(value.slice(0, atToken.start) + inserted + ' ' + value.slice(atToken.end));
    setAtToken(null);
    setAtSuppressed(true); // 插入后不再立刻弹面板，下次输入重置
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
    if (filePanelOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFileSelected((i) => Math.min(i + 1, fileMatches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFileSelected((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        pickFile(fileMatches[fileSelected] ?? fileMatches[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtSuppressed(true);
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
      {filePanelOpen && (
        <div className="command-panel" data-testid="file-panel">
          {fileMatches.map((file, i) => (
            <button
              key={file}
              className={i === fileSelected ? 'command-item selected' : 'command-item'}
              data-testid="file-option"
              onMouseDown={(e) => {
                e.preventDefault();
                pickFile(file);
              }}
            >
              <span className="command-name">@{file}</span>
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
              {[...modelGroups.entries()].map(([provider, providerModels]) => (
                <optgroup key={provider} label={provider}>
                  {providerModels.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                      {m.name ?? m.id}
                    </option>
                  ))}
                </optgroup>
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
        {stagedFiles.length > 0 && (
          <div className="staged-files" data-testid="staged-files">
            {stagedFiles.map((file, i) => (
              <span key={file.name} className="staged-file" data-testid="staged-file">
                {file.name}
                <button
                  className="staged-remove"
                  onClick={() => setStagedFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
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
            setFileSelected(0);
            setAtSuppressed(false);
            setAtToken(detectAtToken(e.target.value, e.target.selectionStart ?? e.target.value.length));
          }}
          onSelect={(e) => {
            // 光标移动（点击/方向键）后重判 @ token
            const target = e.currentTarget;
            setAtToken(detectAtToken(target.value, target.selectionStart ?? target.value.length));
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={3}
        />
        <div className="chat-input-toolbar">
          <label className="attach-button" data-testid="attach-image" title={t('chat.attachFile')}>
            <Paperclip size={16} />
            <input
              type="file"
              accept="image/*,text/*,.md,.markdown,.json,.yaml,.yml,.toml,.xml,.csv,.log"
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
                {totalHitRate != null && (
                  <div className="usage-row"><span>{t('chat.cacheHitRate')}</span><strong>{formatHitRate(totalHitRate)}</strong></div>
                )}
                {lastTurnHitRate != null && (
                  <div className="usage-row"><span>{t('chat.cacheHitRateLast')}</span><strong>{formatHitRate(lastTurnHitRate)}</strong></div>
                )}
                {usageTotals.cost > 0 && (
                  <div className="usage-row"><span>{t('chat.totalCost')}</span><strong>{formatCost(usageTotals.cost)}</strong></div>
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
