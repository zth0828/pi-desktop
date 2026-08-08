import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, AtSign, Brain, ChevronDown, CircleGauge, Folder, ListPlus, Paperclip, Plus, Square, Sparkles } from 'lucide-react';
import type {
  PiCommandRow,
  PiModelRow,
  PiRuntimeContextUsage,
  PiRuntimeSessionInfo,
} from '@shared/host-api/contract';
import { formatFileBlock, isProbablyBinary, MAX_FILE_TEXT_BYTES } from '@shared/file-references';
import { hostApi } from '../../lib/host-api';
import { filterFiles } from '../../lib/file-search';
import { navigateToPage } from '../../lib/app-navigation';
import { cacheHitRate, formatCost, formatHitRate, summarizeUsage } from '../../lib/usage-stats';
import { useChatStore, type ChatMessage } from '../../stores/chat';
import { QueueList } from './QueueList';

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

type FollowupBehavior = 'queue' | 'steer';
type SendWith = 'enter' | 'cmdEnter';

/** 流式中提交的排队方式：设置决定默认行为，Alt 反转（queue ↔ steer） */
function resolveStreamBehavior(followupBehavior: FollowupBehavior, alt: boolean): 'steer' | 'followUp' {
  const base: 'steer' | 'followUp' = followupBehavior === 'steer' ? 'steer' : 'followUp';
  if (!alt) return base;
  return base === 'steer' ? 'followUp' : 'steer';
}

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

/**
 * 壳内建斜杠命令（与 main 侧 SHELL_BUILTIN_COMMANDS 对齐；pi TUI onSubmit 分发的壳映射）。
 * 不在此集合里的 /xxx 原样发给 pi（prompt 模板 / skill / 扩展命令由 pi 展开执行）。
 */
const SHELL_BUILTIN_NAMES = new Set([
  'new',
  'compact',
  'tree',
  'model',
  'name',
  'copy',
  'export',
  'session',
  'settings',
  'login',
  'logout',
  'reload',
  'resume',
]);

/** 带参数的命令：补全面板选中后填入输入框补参数，不直接执行 */
const ARG_BUILTIN_COMMANDS = new Set(['model', 'name', 'export', 'compact']);

/** pi session.getLastAssistantText 语义：最后一条 assistant 消息的文本块拼接。 */
function lastAssistantText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
    if (text) return text;
  }
  return null;
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
  const setTreeOpen = useChatStore((s) => s.setTreeOpen);
  const inputDraft = useChatStore((s) => s.inputDraft);
  const model = useChatStore((s) => s.model);
  const thinkingLevel = useChatStore((s) => s.thinkingLevel);
  const availableThinkingLevels = useChatStore((s) => s.availableThinkingLevels);
  const messages = useChatStore((s) => s.messages);
  const [models, setModels] = useState<PiModelRow[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [contextUsage, setContextUsage] = useState<PiRuntimeContextUsage | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<PiRuntimeSessionInfo | null>(null);
  const [followupBehavior, setFollowupBehavior] = useState<FollowupBehavior>('queue');
  const [sendWith, setSendWith] = useState<SendWith>('enter');
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const usageControlRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!composerMenuOpen && !usageOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (composerMenuOpen && !composerMenuRef.current?.contains(target)) setComposerMenuOpen(false);
      if (usageOpen && !usageControlRef.current?.contains(target)) setUsageOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [composerMenuOpen, usageOpen]);

  /** 命令执行的轻量确认（/name /copy /export /reload 等），5s 自动消失 */
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000);
  };

  useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (started) {
      void hostApi.piRuntime.getCommands().then((r) => setCommands(r.commands));
      void hostApi.providers.listModels().then((r) => setModels(r.models)).catch(() => {});
      void hostApi.piSkills.list().then((r) => setSkills(r.skills)).catch(() => setSkills([]));
      const refreshUsage = () => {
        void hostApi.piRuntime.getContextUsage().then(setContextUsage).catch(() => setContextUsage(null));
      };
      refreshUsage();
      const timer = window.setInterval(refreshUsage, 1000);
      return () => window.clearInterval(timer);
    }
  }, [started]);

  useEffect(() => {
    void hostApi.settings
      .get('followupBehavior')
      .then((v) => setFollowupBehavior(v === 'steer' ? 'steer' : 'queue'));
    void hostApi.settings.get('sendWith').then((v) => setSendWith(v === 'cmdEnter' ? 'cmdEnter' : 'enter'));
  }, []);

  useEffect(() => {
    if (model) setModelKey(`${model.provider}/${model.id}`);
  }, [model]);

  // fork / 跳分支后被选消息的文本回填输入框（TUI /fork、/tree 的 editorText 语义）
  useEffect(() => {
    if (!inputDraft) return;
    setValue(inputDraft.text);
    textareaRef.current?.focus();
  }, [inputDraft]);

  const usageTotals = summarizeUsage(messages);
  const totalHitRate = cacheHitRate(usageTotals);
  const lastTurnHitRate = usageTotals.lastTurn ? cacheHitRate(usageTotals.lastTurn) : null;
  const cacheStatsAvailable = usageTotals.cacheRead + usageTotals.cacheWrite > 0;
  const selectedModel = models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelKey);
  const reasoning = Boolean(selectedModel?.reasoning ?? model?.reasoning);
  const planAvailable = commands.some((command) => /(^|[-_])plan([-_]|$)/i.test(command.name));
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

  /** 模型下拉选中后的统一切换流程（onChange 与 /model <provider/id> 共用） */
  const applyModelSelection = (next: string) => {
    const previous = modelKey;
    setModelKey(next);
    const [provider, ...rest] = next.split('/');
    void hostApi.piRuntime.setModel(provider, rest.join('/')).then(async (result) => {
      if (!result.success) {
        setModelKey(previous);
        return;
      }
      const usage = await hostApi.piRuntime.getContextUsage();
      setContextUsage(usage);
    });
  };

  /** 补全面板里的命令描述：内建命令走 i18n；/compact 内联当前上下文用量（Codex 式 "…(87% full)"） */
  const commandDescription = (cmd: PiCommandRow): string => {
    if (cmd.source !== 'built-in') return cmd.description ?? '';
    if (cmd.name === 'compact') {
      return contextUsage?.tokens == null || contextPercent == null
        ? t('chat.commands.compactUnknown')
        : t('chat.commands.compact', { percent: Math.round(contextPercent) });
    }
    return t(`chat.commands.${cmd.name}`);
  };

  /** 壳内建命令分发（pi TUI onSubmit 的壳映射；动作类命令执行后给轻量确认） */
  const runBuiltinCommand = async (name: string, arg: string) => {
    switch (name) {
      case 'new':
        return void newSession();
      case 'tree':
        return void setTreeOpen(true);
      case 'compact':
        // pi /compact <instructions>：handleCompactCommand 的自定义压缩指令
        return void hostApi.piRuntime.compact(arg || undefined);
      case 'model': {
        if (!arg) {
          // pi /model 无参 = 打开模型选择器 → 壳聚焦并展开聊天页模型下拉
          modelSelectRef.current?.focus();
          modelSelectRef.current?.showPicker?.();
          return;
        }
        const needle = arg.toLowerCase();
        const target =
          models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === needle) ??
          models.find(
            (m) =>
              `${m.provider}/${m.id}`.toLowerCase().includes(needle) ||
              (m.name ?? '').toLowerCase().includes(needle),
          );
        if (!target) {
          showNotice(t('chat.notice.modelNotFound', { model: arg }));
          return;
        }
        applyModelSelection(`${target.provider}/${target.id}`);
        showNotice(t('chat.notice.modelSet', { model: target.name ?? target.id }));
        return;
      }
      case 'name': {
        if (!arg) {
          // pi /name 无参 = 显示当前会话名（未命名则提示用法）
          const info = await hostApi.piRuntime.getSessionInfo().catch(() => null);
          showNotice(
            info?.name
              ? t('chat.notice.currentName', { name: info.name })
              : t('chat.notice.nameUsage'),
          );
          return;
        }
        const result = await hostApi.piRuntime.setSessionName(arg);
        if (result.success) showNotice(t('chat.notice.renamed', { name: result.name ?? arg }));
        else showNotice(t('chat.notice.renameFailed', { message: result.error ?? 'unknown' }));
        return;
      }
      case 'copy': {
        // pi /copy：session.getLastAssistantText → 剪贴板
        const text = lastAssistantText(messages);
        if (!text) {
          showNotice(t('chat.notice.nothingToCopy'));
          return;
        }
        await hostApi.app.writeClipboard(text);
        showNotice(t('chat.notice.copied'));
        return;
      }
      case 'export': {
        const result = await hostApi.piRuntime.exportHtml(arg || undefined);
        if (result.success) showNotice(t('chat.notice.exported', { path: result.path ?? '' }));
        else showNotice(t('chat.notice.exportFailed', { message: result.error ?? 'unknown' }));
        return;
      }
      case 'session': {
        const info = await hostApi.piRuntime.getSessionInfo().catch(() => null);
        if (info) setSessionInfo(info);
        return;
      }
      case 'settings':
        return navigateToPage('settings');
      case 'login':
      case 'logout':
        // pi /login /logout = 供应商认证管理 → 壳的 Models 页
        return navigateToPage('models');
      case 'resume':
        // pi /resume = 会话选择器 → 壳的 Sessions 页
        return navigateToPage('sessions');
      case 'reload': {
        const result = await hostApi.piRuntime.reload();
        if (result.success) {
          showNotice(t('chat.notice.reloaded'));
          // 扩展/skills/prompts 可能变化，重建命令补全列表（TUI setupAutocompleteProvider）
          void hostApi.piRuntime.getCommands().then((r) => setCommands(r.commands));
        } else {
          showNotice(t('chat.notice.reloadFailed', { message: result.error ?? 'unknown' }));
        }
        return;
      }
      default:
        return;
    }
  };

  // / 补全面板：裸 '/' 只显示内置命令 + prompt 模板（skills 多，不打脸）；
  // 输入字符后再全量过滤，前缀匹配优先，built-in > prompt > skill 排序
  const query = value.startsWith('/') && !value.includes(' ') ? value.slice(1) : null;
  const sourceRank = (source: string) =>
    source === 'built-in' ? 0 : source.startsWith('prompt') ? 1 : 2;
  const matches = query === null
    ? []
    : (() => {
        const filtered = commands
          .filter((c) => {
            if (query === '') return sourceRank(c.source) < 2;
            return c.name.toLowerCase().includes(query.toLowerCase());
          })
          .sort((a, b) => {
            const qa = query.toLowerCase();
            const pa = a.name.toLowerCase().startsWith(qa) ? 0 : 1;
            const pb = b.name.toLowerCase().startsWith(qa) ? 0 : 1;
            return pa - pb || sourceRank(a.source) - sourceRank(b.source) || a.name.localeCompare(b.name);
          });
        // 裸 '/' 全量展示内建 + prompt 模板（面板可滚动，对齐 TUI）；过滤时截断 8 条
        return query === '' ? filtered : filtered.slice(0, 8);
      })();
  const panelOpen = matches.length > 0;

  // @ 文件补全：panel 打开时拉一次候选列表（cwd 下相对路径），本地模糊过滤
  const atActive = atToken !== null && !atSuppressed;
  useEffect(() => {
    if (!atActive) return;
    void hostApi.piFiles.list(cwd).then((r) => setFileList(r.files)).catch(() => {});
  }, [atActive, cwd]);
  const fileMatches = atActive ? filterFiles(fileList, atToken.query) : [];
  const filePanelOpen = fileMatches.length > 0;

  const send = (behavior?: 'steer' | 'followUp') => {
    const text = value.trim();
    if (!text && images.length === 0 && stagedFiles.length === 0) return;
    const outgoing = images;
    // 附件文本文件：照 pi file-processor 的 <file name> 块前置于 prompt
    const filePrefix = stagedFiles.map((f) => formatFileBlock(f.name, f.text)).join('');
    setValue('');
    setImages([]);
    setStagedFiles([]);
    // 壳内置命令直接执行，不发给 pi（其余 /xxx 由 pi 展开：prompt 模板/skill/扩展命令）
    if (text.startsWith('/') && outgoing.length === 0 && stagedFiles.length === 0) {
      const spaceIndex = text.indexOf(' ');
      const name = (spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)).toLowerCase();
      if (SHELL_BUILTIN_NAMES.has(name)) {
        void runBuiltinCommand(name, spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim());
        return;
      }
    }
    void prompt(
      filePrefix + text,
      // pi ImageContent 是扁平结构 {type:'image', data, mimeType}
      outgoing.map((img) => ({ type: 'image', data: img.data, mimeType: img.mediaType })),
      behavior,
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
      // 带参命令填入输入框补参数（对齐 pi autocomplete 只补全不执行）；无参命令直接执行
      if (ARG_BUILTIN_COMMANDS.has(cmd.name)) {
        setValue(`/${cmd.name} `);
        textareaRef.current?.focus();
        return;
      }
      setValue('');
      void runBuiltinCommand(cmd.name, '');
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
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (sendWith === 'cmdEnter') {
      // Cmd/Ctrl+Enter 发送；裸 Enter / Shift+Enter 换行
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      send(resolveStreamBehavior(followupBehavior, e.altKey));
      return;
    }
    if (!e.shiftKey) {
      e.preventDefault();
      // 流式中：Enter 按设置的跟进方式分发（默认排队 followUp）；Alt+Enter 始终反向
      send(resolveStreamBehavior(followupBehavior, e.altKey));
    }
  };

  return (
    <div className="chat-input">
      <QueueList />
      {notice && (
        <div className="chat-notice" data-testid="chat-notice">
          {notice}
        </div>
      )}
      {sessionInfo && (
        <div
          className="tree-overlay"
          data-testid="session-info-dialog"
          onClick={() => setSessionInfo(null)}
        >
          <div className="tree-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="tree-title">{t('chat.sessionInfo.title')}</div>
            <div className="session-info-body">
              {sessionInfo.name && (
                <div className="usage-row">
                  <span>{t('chat.sessionInfo.name')}</span>
                  <strong>{sessionInfo.name}</strong>
                </div>
              )}
              <div className="usage-row">
                <span>{t('chat.sessionInfo.id')}</span>
                <strong>{sessionInfo.sessionId}</strong>
              </div>
              <div className="usage-row">
                <span>{t('chat.sessionInfo.file')}</span>
                <strong>{sessionInfo.sessionFile ?? t('chat.sessionInfo.inMemory')}</strong>
              </div>
              {sessionInfo.model && (
                <div className="usage-row">
                  <span>{t('chat.sessionInfo.model')}</span>
                  <strong>
                    {sessionInfo.model.name ??
                      `${sessionInfo.model.provider}/${sessionInfo.model.id}`}
                  </strong>
                </div>
              )}
              <div className="usage-row">
                <span>{t('chat.sessionInfo.messages')}</span>
                <strong>
                  {t('chat.sessionInfo.messagesValue', {
                    total: sessionInfo.totalMessages,
                    user: sessionInfo.userMessages,
                    assistant: sessionInfo.assistantMessages,
                  })}
                </strong>
              </div>
              <div className="usage-row">
                <span>{t('chat.sessionInfo.tools')}</span>
                <strong>
                  {t('chat.sessionInfo.toolsValue', {
                    calls: sessionInfo.toolCalls,
                    results: sessionInfo.toolResults,
                  })}
                </strong>
              </div>
              <div className="usage-row">
                <span>{t('chat.sessionInfo.input')}</span>
                <strong>{formatTokens(sessionInfo.tokens.input)}</strong>
              </div>
              <div className="usage-row">
                <span>{t('chat.sessionInfo.output')}</span>
                <strong>{formatTokens(sessionInfo.tokens.output)}</strong>
              </div>
              <div className="usage-row">
                <span>{t('chat.sessionInfo.total')}</span>
                <strong>{formatTokens(sessionInfo.tokens.total)}</strong>
              </div>
              {sessionInfo.cost > 0 && (
                <div className="usage-row">
                  <span>{t('chat.sessionInfo.cost')}</span>
                  <strong>{formatCost(sessionInfo.cost)}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
              <span className="command-desc">{commandDescription(cmd)}</span>
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
              ref={modelSelectRef}
              className="context-chip model-select"
              data-testid="model-select"
              aria-label={t('chat.model')}
              value={modelKey}
              onChange={(e) => applyModelSelection(e.target.value)}
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
          {reasoning && availableThinkingLevels.length > 0 && (
            <select
              className="context-chip thinking-select"
              data-testid="thinking-level-select"
              aria-label={t('chat.thinkingLevel')}
              value={thinkingLevel}
              onChange={(e) => { void hostApi.piRuntime.setThinkingLevel(e.target.value); }}
            >
              {availableThinkingLevels.map((level) => <option key={level} value={level}>{t(`chat.thinkingLevels.${level}`, { defaultValue: level })}</option>)}
            </select>
          )}
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
          placeholder={sendWith === 'cmdEnter' ? t('chat.placeholderCmdEnter') : t('chat.placeholder')}
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
          <div className="composer-menu-wrap" ref={composerMenuRef}>
            <input id="chat-attach-input" type="file" accept="image/*,text/*,.md,.markdown,.json,.yaml,.yml,.toml,.xml,.csv,.log" multiple hidden data-testid="attach-input" onChange={(e) => { void stageFiles(Array.from(e.target.files ?? [])); e.target.value = ''; setComposerMenuOpen(false); }} />
            <button className="attach-button" data-testid="composer-menu" title={t('chat.composerMenu')} aria-expanded={composerMenuOpen} onClick={() => setComposerMenuOpen((open) => !open)}><Plus size={17} /></button>
            {composerMenuOpen && (
              <div className="composer-menu" role="menu">
                <label className="composer-menu-item" data-testid="attach-image" htmlFor="chat-attach-input" title={t('chat.attachFile')}>
                  <Paperclip size={15} /><span>{t('chat.attachFile')}</span>
                </label>
                <button className="composer-menu-item" data-testid="composer-file-reference" onClick={() => { setValue((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@`); setComposerMenuOpen(false); textareaRef.current?.focus(); }}><AtSign size={15} /><span>{t('chat.fileReference')}</span></button>
                <div className="composer-menu-section"><Sparkles size={14} /><span>{t('chat.skills')}</span></div>
                <div className="composer-skills-list">
                  {skills.length === 0 ? <div className="composer-menu-hint">{t('chat.noSkills')}</div> : skills.map((skill) => <button className="composer-menu-item" data-testid={`composer-skill-${skill.name}`} key={skill.name} onClick={() => { setValue(`/skill:${skill.name} `); setComposerMenuOpen(false); textareaRef.current?.focus(); }}><Sparkles size={14} /><span>{skill.name}</span></button>)}
                </div>
                <button className="composer-menu-item" data-testid="composer-plan-mode" disabled={!planAvailable} title={!planAvailable ? t('chat.planModeUnavailable') : undefined} onClick={() => { setValue('/plan '); setComposerMenuOpen(false); textareaRef.current?.focus(); }}><Brain size={15} /><span>{t('chat.planMode')}</span></button>
              </div>
            )}
          </div>
          <span className="spacer" />
          <div className="usage-control" ref={usageControlRef}>
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
                {selectedModel?.maxTokens != null && <div className="usage-row"><span>{t('chat.maxOutputTokens')}</span><strong>{formatTokens(selectedModel.maxTokens)}</strong></div>}
                <div className="usage-row"><span>{t('chat.inputTokens')}</span><strong>{formatTokens(usageTotals.input)}</strong></div>
                <div className="usage-row"><span>{t('chat.outputTokens')}</span><strong>{formatTokens(usageTotals.output)}</strong></div>
                {(usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && (
                  <>
                    <div className="usage-row"><span>{t('chat.cacheRead')}</span><strong>{formatTokens(usageTotals.cacheRead)}</strong></div>
                    <div className="usage-row"><span>{t('chat.cacheWrite')}</span><strong>{formatTokens(usageTotals.cacheWrite)}</strong></div>
                  </>
                )}
                {cacheStatsAvailable && totalHitRate != null && (
                  <div className="usage-row"><span>{t('chat.cacheHitRate')}</span><strong>{formatHitRate(totalHitRate)}</strong></div>
                )}
                {cacheStatsAvailable && lastTurnHitRate != null && (
                  <div className="usage-row"><span>{t('chat.cacheHitRateLast')}</span><strong>{formatHitRate(lastTurnHitRate)}</strong></div>
                )}
                {usageTotals.cost > 0 && (
                  <div className="usage-row"><span>{t('chat.totalCost')}</span><strong>{formatCost(usageTotals.cost)}</strong></div>
                )}
                <div className="usage-note">{t('chat.cacheStatsNote')}</div>
              </div>
            )}
          </div>
          {isStreaming ? (
            <>
              <button
                data-testid="chat-queue-send"
                className="send-button"
                onClick={(e) => send(resolveStreamBehavior(followupBehavior, e.altKey))}
                disabled={!value.trim() && images.length === 0}
                title={
                  followupBehavior === 'steer' ? t('chat.queueSendTipSteer') : t('chat.queueSendTip')
                }
              >
                <ListPlus size={15} />
              </button>
              <button
                data-testid="chat-stop"
                className="send-button stop"
                onClick={() => void abort()}
                title={t('chat.stopTip')}
              >
                <Square size={13} />
              </button>
            </>
          ) : (
            <button
              data-testid="chat-send"
              className="send-button"
              onClick={() => send()}
              disabled={!value.trim() && images.length === 0}
              title={sendWith === 'cmdEnter' ? t('chat.sendTipCmdEnter') : t('chat.sendTip')}
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
