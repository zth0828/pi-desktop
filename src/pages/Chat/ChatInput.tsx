import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, AtSign, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, CircleGauge, FileText, Folder, GitBranch, Paperclip, Plus, Square, Sparkles, Terminal, X } from 'lucide-react';
import { DEFAULT_CONTEXT_WINDOW } from '@shared/host-api/contract';
import type {
  PiCommandRow,
  PiModelRow,
  PiRuntimeSessionInfo,
  PiRuntimeUsageResult,
} from '@shared/host-api/contract';
import { isProbablyBinary, MAX_FILE_TEXT_BYTES } from '@shared/file-references';
import { formatOrderedAttachmentPrompt, stripAttachmentEnvelope } from '@shared/message-attachments';
import { hostApi } from '../../lib/host-api';
import { filterFiles } from '../../lib/file-search';
import { navigateToPage } from '../../lib/app-navigation';
import { cacheHitRate, formatCost, formatHitRate } from '../../lib/usage-stats';
import { sessionTitleFromQuestion } from '../../lib/session-title';
import type { ChatMessage, ComposerAttachment } from '../../stores/chat';
import { usePaneChatStore, usePaneChatStoreApi, usePaneHostApi } from './chat-store-context';
import { ImageLightbox } from './ImageLightbox';
import { QueueList } from './QueueList';

type StagedImage = Extract<ComposerAttachment, { kind: 'image' }>;
type StagedFile = Extract<ComposerAttachment, { kind: 'file' }>;
type StagedAttachment = ComposerAttachment;

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
};

type FollowupBehavior = 'queue' | 'steer';
type SendWith = 'enter' | 'cmdEnter';

function modelDisplayName(model: PiModelRow): string {
  let name = model.name ?? model.id;
  for (const suffix of [model.provider, model.providerLabel]) {
    if (!suffix) continue;
    if (name.toLowerCase().endsWith(` (${suffix.toLowerCase()})`)) {
      name = name.slice(0, -(suffix.length + 3));
    }
  }
  return name;
}

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
        kind: 'image',
        name: file.name,
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

export function ChatInput({ cwd, onChooseWorkspace }: ChatInputProps) {
  const { t } = useTranslation();
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);
  const [commands, setCommands] = useState<PiCommandRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [atToken, setAtToken] = useState<AtToken | null>(null);
  const [atSuppressed, setAtSuppressed] = useState(false);
  const [fileList, setFileList] = useState<string[]>([]);
  const [fileSelected, setFileSelected] = useState(0);
  const chatStore = usePaneChatStoreApi();
  const paneApi = usePaneHostApi();
  const isStreaming = usePaneChatStore((s) => s.isStreaming);
  const isRunning = usePaneChatStore((s) => s.running);
  const compacting = usePaneChatStore((s) => s.compaction !== null);
  const transcriptSyncing = usePaneChatStore((s) => s.transcriptSyncing);
  const lastCompaction = usePaneChatStore((s) => s.lastCompaction);
  const runtimeContextUsage = usePaneChatStore((s) => s.contextUsage);
  const retrying = usePaneChatStore((s) => s.retry !== null);
  const bashing = usePaneChatStore((s) => s.bashDraft !== null);
  const commandMode = usePaneChatStore((s) => s.commandMode);
  const commandExcludeFromContext = usePaneChatStore((s) => s.commandExcludeFromContext);
  const setCommandMode = usePaneChatStore((s) => s.setCommandMode);
  const setCommandExcludeFromContext = usePaneChatStore((s) => s.setCommandExcludeFromContext);
  const started = usePaneChatStore((s) => s.started);
  const prompt = usePaneChatStore((s) => s.prompt);
  const runBash = usePaneChatStore((s) => s.runBash);
  const abort = usePaneChatStore((s) => s.abort);
  const newSession = usePaneChatStore((s) => s.newSession);
  const setTreeOpen = usePaneChatStore((s) => s.setTreeOpen);
  const inputDraft = usePaneChatStore((s) => s.inputDraft);
  const value = usePaneChatStore((s) => s.composerText);
  const attachments = usePaneChatStore((s) => s.composerAttachments);
  const sessionId = usePaneChatStore((s) => s.sessionId);
  const generation = usePaneChatStore((s) => s.generation);
  const setComposerText = usePaneChatStore((s) => s.setComposerText);
  const setComposerAttachments = usePaneChatStore((s) => s.setComposerAttachments);
  const clearInputDraft = usePaneChatStore((s) => s.clearInputDraft);
  const model = usePaneChatStore((s) => s.model);
  const thinkingLevel = usePaneChatStore((s) => s.thinkingLevel);
  const availableThinkingLevels = usePaneChatStore((s) => s.availableThinkingLevels);
  // messages 只在 /copy 与首发自动命名时读取（调用时取快照，见下），不订阅——
  // 否则流式每个 chunk 都会重渲染输入框组件树（流式热路径）
  const [models, setModels] = useState<PiModelRow[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [usage, setUsage] = useState<PiRuntimeUsageResult | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<PiRuntimeSessionInfo | null>(null);
  const [followupBehavior, setFollowupBehavior] = useState<FollowupBehavior>('queue');
  const [sendWith, setSendWith] = useState<SendWith>('enter');
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchList, setBranchList] = useState<string[]>([]);
  const [isBranchDirty, setIsBranchDirty] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  /** 计划模式：常驻切换，开启后发送带 /plan 前缀（默认直接执行）。 */
  const [planMode, setPlanMode] = useState(false);
  /** 已选中的 skill（单选，显示为输入框上方 badge）：发送时拼 /skill:name 前缀。 */
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  /** 加号菜单「引用文件」手动打开的文件面板（无需先输入 @）。 */
  const [filePanelManual, setFilePanelManual] = useState(false);
  /** 手动文件面板树：根层内容 + 已展开子目录内容（相对路径 key）+ 展开状态。 */
  const [dirTree, setDirTree] = useState<{ dir: string; dirs: string[]; files: string[] } | null>(null);
  const [dirContents, setDirContents] = useState<Record<string, { dirs: string[]; files: string[] }>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuSection, setModelMenuSection] = useState<'models' | 'thinking' | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const [composerScrollable, setComposerScrollable] = useState(false);
  const [composerScrollbarActive, setComposerScrollbarActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandPanelRef = useRef<HTMLDivElement>(null);
  const filePanelRef = useRef<HTMLDivElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const usageControlRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const composerScrollTimerRef = useRef<number | null>(null);

  const setValue = (next: string | ((current: string) => string)) => {
    setComposerText(typeof next === 'function' ? next(chatStore.getState().composerText) : next);
  };
  const setAttachments = (next: StagedAttachment[] | ((current: StagedAttachment[]) => StagedAttachment[])) => {
    setComposerAttachments(typeof next === 'function' ? next(chatStore.getState().composerAttachments) : next);
  };

  const resizeComposer = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maximum = Math.max(112, Math.min(260, Math.round(window.innerHeight * 0.32)));
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, maximum);
    textarea.style.height = `${nextHeight}px`;
    const scrollable = textarea.scrollHeight > maximum + 1;
    setComposerScrollable(scrollable);
    if (!scrollable) setComposerScrollbarActive(false);
  };

  useLayoutEffect(() => { resizeComposer(); }, [value]);

  useEffect(() => {
    const resize = () => resizeComposer();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // @ 文件面板：手动浏览或 @ 输入补全任一打开即显示（派生值，先于下方 useEffect 声明）
  const atActive = atToken !== null && !atSuppressed;
  const filePanelOpen = filePanelManual || (atActive && filterFiles(fileList, atToken?.query ?? '').length > 0);

  useEffect(() => {
    if (!composerMenuOpen && !usageOpen && !modelMenuOpen && !branchMenuOpen && !filePanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (composerMenuOpen && !composerMenuRef.current?.contains(target)) setComposerMenuOpen(false);
      if (usageOpen && !usageControlRef.current?.contains(target)) setUsageOpen(false);
      if (modelMenuOpen && !modelMenuRef.current?.contains(target)) setModelMenuOpen(false);
      if (branchMenuOpen && !branchMenuRef.current?.contains(target)) setBranchMenuOpen(false);
      // 文件面板：点击面板外关闭（@ 补全或手动浏览均适用）
      if (filePanelOpen && !filePanelRef.current?.contains(target)) {
        setFilePanelManual(false);
        setAtSuppressed(true);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setComposerMenuOpen(false);
      setUsageOpen(false);
      setModelMenuOpen(false);
      setBranchMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [composerMenuOpen, usageOpen, modelMenuOpen, branchMenuOpen, filePanelOpen]);

  /** 命令执行的轻量确认（/name /copy /export /reload 等），5s 自动消失 */
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000);
  };

  useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (composerScrollTimerRef.current) window.clearTimeout(composerScrollTimerRef.current);
    },
    [],
  );

  const revealComposerScrollbar = () => {
    if (!composerScrollable) return;
    setComposerScrollbarActive(true);
    if (composerScrollTimerRef.current) window.clearTimeout(composerScrollTimerRef.current);
    composerScrollTimerRef.current = window.setTimeout(() => setComposerScrollbarActive(false), 700);
  };

  useEffect(() => {
    let disposed = false;
    if (started) {
      void paneApi.piRuntime.getCommands().then((r) => { if (!disposed) setCommands(r.commands); });
      void hostApi.providers.listModels().then((r) => { if (!disposed) setModels(r.models); }).catch(() => {});
      void paneApi.piSkills.list().then((r) => { if (!disposed) setSkills(r.skills); }).catch(() => {});
      const refreshUsage = () => {
        if (chatStore.getState().compaction || chatStore.getState().transcriptSyncing) return;
        void paneApi.piRuntime.getUsage()
          .then((next) => {
            if (!disposed && !chatStore.getState().compaction && !chatStore.getState().transcriptSyncing) setUsage(next);
          })
          .catch(() => { if (!disposed) setUsage(null); });
      };
      // 压缩或快照重建期间，旧 token/context 数值已经失效，先清空旧快照。
      if (compacting || transcriptSyncing) setUsage(null);
      else refreshUsage();
      const timer = window.setInterval(refreshUsage, isStreaming || compacting || transcriptSyncing ? 400 : 1000);
      return () => {
        disposed = true;
        window.clearInterval(timer);
      };
    }
    setUsage(null);
    return () => { disposed = true; };
  }, [started, sessionId, generation, paneApi, isStreaming, compacting, transcriptSyncing, lastCompaction]);

  useEffect(() => {
    void hostApi.settings
      .get('followupBehavior')
      .then((v) => setFollowupBehavior(v === 'steer' ? 'steer' : 'queue'));
    void hostApi.settings.get('sendWith').then((v) => setSendWith(v === 'cmdEnter' ? 'cmdEnter' : 'enter'));
  }, []);

  useEffect(() => {
    if (model) setModelKey(`${model.provider}/${model.id}`);
  }, [model]);

  // 当前工作区 git 分支：cwd 切换后立即刷新，并低频轮询跟随 checkout 换分支
  // （与 pi TUI footer 同口径；非仓库返回 null 时不显示 chip）。
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void hostApi.git.getBranch(cwd)
        .then((result) => { if (!disposed) setGitBranch(result.branch ?? null); })
        .catch(() => { if (!disposed) setGitBranch(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cwd]);

  // fork / 跳分支后被选消息的文本与附件回填输入框（TUI /fork、/tree 的 editorText 语义）
  useEffect(() => {
    if (!inputDraft) return;
    setValue(inputDraft.text);
    if (inputDraft.attachments !== undefined) {
      setAttachments(inputDraft.attachments);
    }
    clearInputDraft();
    textareaRef.current?.focus();
  }, [inputDraft, clearInputDraft]);

  const hasMessages = usePaneChatStore((s) => s.messages.length > 0 || s.historyMessages.length > 0);
  const canSwitchBranch = started && !isStreaming && !isRunning && !hasMessages;

  const toggleBranchMenu = () => {
    if (!canSwitchBranch) return;
    if (branchMenuOpen) {
      setBranchMenuOpen(false);
      return;
    }
    const chatState = chatStore.getState();
    if ((chatState.messages?.length ?? 0) > 0 || (chatState.historyMessages?.length ?? 0) > 0) {
      return;
    }
    setBranchMenuOpen(true);
    setLoadingBranches(true);
    hostApi.git.listBranches(cwd)
      .then((result) => {
        setBranchList(result.branches);
        setIsBranchDirty(result.isDirty);
        if (result.current) setGitBranch(result.current);
      })
      .catch(() => {
        setBranchList([]);
        setIsBranchDirty(false);
      })
      .finally(() => {
        setLoadingBranches(false);
      });
  };

  const handleSwitchBranch = async (targetBranch: string) => {
    if (targetBranch === gitBranch || switchingBranch) return;
    setSwitchingBranch(true);
    try {
      const result = await hostApi.git.checkout(cwd, targetBranch);
      if (result.success) {
        setGitBranch(targetBranch);
        setBranchMenuOpen(false);
        showNotice(t('chat.branchSwitch.success', { branch: targetBranch }));
      } else {
        if (result.error === 'dirty') {
          showNotice(t('chat.branchSwitch.dirty'));
        } else if (result.error === 'running') {
          showNotice(t('chat.branchSwitch.running'));
        } else {
          showNotice(t('chat.branchSwitch.failed', { error: result.error ?? 'unknown' }));
        }
      }
    } catch (err) {
      showNotice(t('chat.branchSwitch.failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSwitchingBranch(false);
    }
  };

  const contextUsage = usage?.context ?? runtimeContextUsage ?? null;
  const usageTotals = usage?.session ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const totalHitRate = cacheHitRate(usageTotals);
  const lastTurnHitRate = usage?.latestTurn ? cacheHitRate(usage.latestTurn) : null;
  const cacheStatsAvailable = usageTotals.cacheRead + usageTotals.cacheWrite > 0;
  const selectedModel = models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelKey);
  const reasoning = Boolean(model?.reasoning ?? selectedModel?.reasoning);
  const hasCustomLevels = availableThinkingLevels.length > 1
    || (availableThinkingLevels.length === 1 && availableThinkingLevels[0] !== 'off');
  const effectiveThinkingLevels = hasCustomLevels
    ? availableThinkingLevels
    : reasoning ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : availableThinkingLevels;
  const planAvailable = commands.some((command) => /(^|[-_])plan([-_]|$)/i.test(command.name));
  // 模型下拉按供应商分组（optgroup），供应商顺序保持 listModels 的首现顺序
  const modelGroups = new Map<string, PiModelRow[]>();
  for (const m of models) {
    const label = m.providerLabel ?? m.provider;
    const group = modelGroups.get(label);
    if (group) group.push(m);
    else modelGroups.set(label, [m]);
  }

  useEffect(() => {
    if (modelMenuOpen) {
      const currentGroup = selectedModel
        ? (selectedModel.providerLabel ?? selectedModel.provider)
        : (model ? model.provider : null);
      const initialCollapsed = new Set<string>();
      for (const provider of modelGroups.keys()) {
        if (provider !== currentGroup) {
          initialCollapsed.add(provider);
        }
      }
      setCollapsedProviders(initialCollapsed);
    } else {
      setModelMenuSection(null);
    }
  }, [modelMenuOpen]);

  const toggleProviderCollapse = (provider: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };
  const contextWindow = model?.contextWindow ?? selectedModel?.contextWindow
    ?? (contextUsage?.contextWindow && contextUsage.contextWindow > 0 ? contextUsage.contextWindow : DEFAULT_CONTEXT_WINDOW);
  // pi 在压缩后可能明确返回 tokens=null：这表示暂时未知，不应伪装成 0%。
  const contextTokens = contextUsage?.tokens ?? null;
  const contextPercent = contextUsage?.percent != null
    ? Math.max(0, Math.min(100, contextUsage.percent))
    : contextTokens != null && contextWindow > 0
      ? Math.max(0, Math.min(100, (contextTokens / contextWindow) * 100))
      : null;
  const contextLabel = compacting || transcriptSyncing
    ? t('chat.contextSyncing')
    : contextPercent == null ? t('chat.tokenUnknown') : `${Math.round(contextPercent)}%`;
  const formatTokens = (value: number | null | undefined) =>
    value == null ? t('chat.tokenUnknown') : value.toLocaleString();

  /** 模型下拉选中后的统一切换流程（onChange 与 /model <provider/id> 共用） */
  const applyModelSelection = (next: string) => {
    const previous = modelKey;
    setModelKey(next);
    const [provider, ...rest] = next.split('/');
    void paneApi.piRuntime.setModel(provider, rest.join('/')).then(async (result) => {
      if (!result.success) {
        setModelKey(previous);
        return;
      }
      chatStore.getState().applyModelUpdate(result);
      const nextUsage = await paneApi.piRuntime.getUsage();
      setUsage(nextUsage);
    });
  };

  /** 补全面板里的命令描述：内建命令走 i18n；/compact 内联当前上下文用量（Codex 式 "…(87% full)"） */
  const commandDescription = (cmd: PiCommandRow): string => {
    if (cmd.source !== 'built-in') return cmd.description ?? '';
    if (cmd.name === 'compact') {
      return contextPercent == null
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
        return void paneApi.piRuntime.compact(arg || undefined);
      case 'model': {
        if (!arg) {
          // pi /model 无参 = 打开模型选择器 → 壳展开聊天页模型菜单
          setModelMenuSection('models');
          setModelMenuOpen(true);
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
          const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
          showNotice(
            info?.name
              ? t('chat.notice.currentName', { name: info.name })
              : t('chat.notice.nameUsage'),
          );
          return;
        }
        const result = await paneApi.piRuntime.setSessionName(arg);
        if (result.success) showNotice(t('chat.notice.renamed', { name: result.name ?? arg }));
        else showNotice(t('chat.notice.renameFailed', { message: result.error ?? 'unknown' }));
        return;
      }
      case 'copy': {
        // pi /copy：session.getLastAssistantText → 剪贴板
        const text = lastAssistantText(chatStore.getState().messages);
        if (!text) {
          showNotice(t('chat.notice.nothingToCopy'));
          return;
        }
        await hostApi.app.writeClipboard(text);
        showNotice(t('chat.notice.copied'));
        return;
      }
      case 'export': {
        const result = await paneApi.piRuntime.exportHtml(arg || undefined);
        if (result.success) showNotice(t('chat.notice.exported', { path: result.path ?? '' }));
        else showNotice(t('chat.notice.exportFailed', { message: result.error ?? 'unknown' }));
        return;
      }
      case 'session': {
        const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
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
        const result = await paneApi.piRuntime.reload();
        if (result.success) {
          showNotice(t('chat.notice.reloaded'));
          // 扩展/skills/prompts 可能变化，重建命令补全列表（TUI setupAutocompleteProvider）
          void paneApi.piRuntime.getCommands().then((r) => setCommands(r.commands));
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

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!panelOpen) return;
    commandPanelRef.current
      ?.querySelector<HTMLElement>('.command-item.selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [panelOpen, query, selected]);

  // @ 文件补全：panel 打开时拉一次候选列表（cwd 下相对路径），本地模糊过滤
  useEffect(() => {
    if (!atActive && !filePanelManual) return;
    void hostApi.piFiles.list(cwd).then((r) => setFileList(r.files)).catch(() => {});
  }, [atActive, filePanelManual, cwd]);
  const fileMatches = atActive ? filterFiles(fileList, atToken.query) : filterFiles(fileList, '');

  useEffect(() => {
    const stopOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || (!isStreaming && !isRunning)) return;
      if (panelOpen || filePanelOpen || composerMenuOpen || usageOpen || modelMenuOpen) return;
      // 焦点在其他浮层（侧栏会话菜单、对话框等）时按 Escape 只关该浮层，不触发 stop
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body && !target.closest('.chat-input-card')) return;
      event.preventDefault();
      void abort();
    };
    document.addEventListener('keydown', stopOnEscape);
    return () => document.removeEventListener('keydown', stopOnEscape);
  }, [abort, composerMenuOpen, filePanelOpen, isRunning, isStreaming, modelMenuOpen, panelOpen, usageOpen]);

  useEffect(() => {
    setFileSelected(0);
  }, [atToken?.query]);

  useEffect(() => {
    if (!filePanelOpen) return;
    filePanelRef.current
      ?.querySelector<HTMLElement>('.command-item.selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [atToken?.query, filePanelOpen, fileSelected]);

  const send = (behavior?: 'steer' | 'followUp') => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    // bash 一次一个：命令模式上一条未完成时不消费输入（按钮 title 已提示）
    if (commandMode && bashing) return;
    const outgoingAttachments = attachments;
    const outgoing = outgoingAttachments.filter((attachment): attachment is StagedImage => attachment.kind === 'image');
    // plan 与 skill 前缀互斥：pi 只展开开头的单个 / 命令，同时存在时 plan 优先
    const modePrefix = planMode ? '/plan ' : selectedSkill ? `/skill:${selectedSkill} ` : '';
    const promptText = modePrefix + formatOrderedAttachmentPrompt(text, outgoingAttachments);
    setValue('');
    setAttachments([]);
    // 命令模式：发送即 bash 执行（上下文策略由开关决定，默认不入上下文）；
    // 发送后退出命令模式，避免下一条普通消息被误当成命令。
    if (commandMode) {
      setCommandMode(false);
      if (text && !bashing) void runBash(text, commandExcludeFromContext);
      return;
    }
    // `!` bash 命令模式（pi TUI：`!cmd` 执行并入上下文，`!!cmd` 执行但不入上下文）；
    // 兼容中文输入法的全角 `！` 前缀。
    if ((text.startsWith('!') || text.startsWith('！')) && outgoingAttachments.length === 0) {
      const isExcluded = text.startsWith('!!') || text.startsWith('！！');
      const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
      if (command) void runBash(command, isExcluded);
      return;
    }
    // 壳内置命令直接执行，不发给 pi（其余 /xxx 由 pi 展开：prompt 模板/skill/扩展命令）
    if (text.startsWith('/') && outgoingAttachments.length === 0) {
      const spaceIndex = text.indexOf(' ');
      const name = (spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)).toLowerCase();
      if (SHELL_BUILTIN_NAMES.has(name)) {
        void runBuiltinCommand(name, spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim());
        return;
      }
    }
    const autoTitle = chatStore.getState().messages.length === 0
      ? sessionTitleFromQuestion(text, t('chat.imageSessionTitle'))
      : null;
    void prompt(
      promptText,
      // pi ImageContent 是扁平结构 {type:'image', data, mimeType}
      outgoing.map((img) => ({ type: 'image', data: img.data, mimeType: img.mediaType })),
      behavior,
    ).then(async () => {
      // 等 prompt 返回后再持久化，避免 sessionReplaced 与扩展 UI 请求竞态。
      if (!autoTitle) return;
      const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
      // pi 可能已按首条消息（含附件信封）自动命名，脏名也用干净标题覆盖
      const dirtyName = info?.name ? stripAttachmentEnvelope(info.name) !== info.name : false;
      if (!info?.name || dirtyName) await paneApi.piRuntime.setSessionName(autoTitle, false).catch(() => {});
    });
  };

  const stageFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const staged = await fileToStagedImage(file);
          setAttachments((prev) => [...prev, staged]);
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
        setAttachments((prev) => [...prev, { kind: 'file', name: file.name, text }]);
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
  const pickFile = async (relPath: string) => {
    // 附件式引用：读文件内容暂存（不写入输入框），发送时按 <file> 块拼进 prompt
    const result = await hostApi.workspace.readFile(relPath).catch(() => null);
    const text = result?.text;
    if (text && !isProbablyBinary(text)) {
      setAttachments((current) => [...current, { kind: 'file', name: relPath, text }]);
    }
    if (filePanelManual) setFilePanelManual(false);
    if (atToken) {
      // 移除输入框里的 @token 文本（引用已改为附件，不再写 @path）
      setValue(value.slice(0, atToken.start) + value.slice(atToken.end));
      setAtToken(null);
    }
    setAtSuppressed(true); // 插入后不再立刻弹面板，下次输入重置
    textareaRef.current?.focus();
  };

  /** 目录节点展开/收起：首展开时按需加载子目录内容。 */
  const toggleDir = (name: string, parent: string) => {
    const full = parent ? `${parent}/${name}` : name;
    if (expandedDirs.has(full)) {
      setExpandedDirs((prev) => { const next = new Set(prev); next.delete(full); return next; });
      return;
    }
    setExpandedDirs((prev) => new Set(prev).add(full));
    if (!dirContents[full]) {
      void hostApi.piFiles.listDir(cwd, full).then((r) => {
        setDirContents((prev) => ({ ...prev, [full]: r }));
      }).catch(() => {});
    }
  };

  /** 手动文件面板的树形渲染：目录可展开，文件可选中为附件。 */
  const renderDirTree = (dir: string, content: { dirs: string[]; files: string[] }, depth: number): ReactNode[] => {
    const nodes: ReactNode[] = [];
    for (const name of content.dirs) {
      const full = dir ? `${dir}/${name}` : name;
      const open = expandedDirs.has(full);
      nodes.push(
        <button key={`d:${full}`} className="command-item file-dir" data-testid="file-dir" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggleDir(name, dir)}>
          <ChevronRight size={12} className={`file-dir-chevron${open ? ' open' : ''}`} />
          <Folder size={13} />
          <span className="command-name">{name}</span>
        </button>,
      );
      const child = dirContents[full];
      if (open && child) nodes.push(...renderDirTree(full, child, depth + 1));
    }
    for (const name of content.files) {
      const full = dir ? `${dir}/${name}` : name;
      nodes.push(
        <button
          key={`f:${full}`}
          className="command-item"
          data-testid="file-option"
          style={{ paddingLeft: 10 + depth * 14 + 18 }}
          onMouseDown={(e) => { e.preventDefault(); void pickFile(full); }}
        >
          <FileText size={13} />
          <span className="command-name">{name}</span>
        </button>,
      );
    }
    return nodes;
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
        setFilePanelManual(false);
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
        <div ref={commandPanelRef} className="command-panel" data-testid="command-panel">
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
        <div ref={filePanelRef} className="command-panel" data-testid="file-panel">
          {filePanelManual ? (
            dirTree ? renderDirTree('', dirTree, 0) : null
          ) : (
            fileMatches.map((file, i) => (
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
            ))
          )}
        </div>
      )}
      <div className="chat-input-card">
        {attachments.length > 0 && (
          <div className="staged-attachments" data-testid="staged-attachments">
            {attachments.map((attachment, index) => attachment.kind === 'image' ? (
              <span key={`${attachment.name}-${index}`} className="staged-image" data-testid="staged-image" data-attachment-index={index + 1}>
                <button
                  className="staged-image-preview"
                  data-testid="staged-image-preview"
                  aria-label={t('chat.imageAttachment', { index: index + 1, name: attachment.name })}
                  onClick={() => setPreviewImage({ url: attachment.previewUrl, name: attachment.name })}
                >
                  <img src={attachment.previewUrl} alt={attachment.name} />
                  <span className="attachment-order">{index + 1}</span>
                </button>
                <button
                  className="staged-remove"
                  aria-label={t('chat.removeAttachment')}
                  onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            ) : (
              <span key={`${attachment.name}-${index}`} className="staged-file" data-testid="staged-file" data-attachment-index={index + 1}>
                <span className="attachment-order">{index + 1}</span>
                <FileText size={14} />
                <span className="staged-file-name">{attachment.name}</span>
                <button
                  className="staged-remove"
                  aria-label={t('chat.removeAttachment')}
                  onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            ))}
          </div>
        )}
        {commandMode && (
          <div className="command-mode-bar" data-testid="command-mode-bar">
            <span className="command-mode-label"><Terminal size={13} />{t('chat.command.mode')}</span>
            <button
              className={`command-context-toggle${commandExcludeFromContext ? '' : ' in-context'}`}
              data-testid="command-context-toggle"
              title={commandExcludeFromContext ? t('chat.command.includeContext') : t('chat.command.excludeContext')}
              onClick={() => setCommandExcludeFromContext(!commandExcludeFromContext)}
            >
              {commandExcludeFromContext ? t('chat.bash.excluded') : t('chat.command.inContext')}
            </button>
            <button className="command-mode-exit" data-testid="command-mode-exit" aria-label={t('chat.command.exit')} title={t('chat.command.exit')} onClick={() => setCommandMode(false)}><X size={13} /></button>
          </div>
        )}
        {selectedSkill && (
          <div className="skill-mode-bar" data-testid="skill-mode-bar">
            <span className="skill-mode-label"><Sparkles size={13} />/skill:{selectedSkill}</span>
            <button
              className="skill-mode-remove"
              data-testid="skill-mode-remove"
              aria-label={t('chat.skillRemove')}
              title={t('chat.skillRemove')}
              onClick={() => setSelectedSkill(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          className={`${composerScrollable ? 'is-scrollable' : ''}${composerScrollbarActive ? ' scrollbar-active' : ''}`}
          value={value}
          placeholder={commandMode ? t('chat.command.placeholder') : sendWith === 'cmdEnter' ? t('chat.placeholderCmdEnter') : t('chat.placeholder')}
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
          onScroll={revealComposerScrollbar}
          onWheel={revealComposerScrollbar}
          rows={1}
        />
        <div className="chat-input-toolbar">
          <div className="composer-menu-wrap" ref={composerMenuRef}>
            <input id="chat-attach-input" type="file" accept="image/*,text/*,.md,.markdown,.json,.yaml,.yml,.toml,.xml,.csv,.log" multiple hidden data-testid="attach-input" onChange={(e) => { void stageFiles(Array.from(e.target.files ?? [])); e.target.value = ''; setComposerMenuOpen(false); }} />
            <button className="attach-button" data-testid="composer-menu" title={t('chat.composerMenu')} aria-expanded={composerMenuOpen} onClick={() => setComposerMenuOpen((open) => !open)}><Plus size={17} /></button>
            {composerMenuOpen && (
              <div className="composer-menu" role="menu" data-testid="composer-menu-panel">
                <label className="composer-menu-item" data-testid="attach-image" htmlFor="chat-attach-input" title={t('chat.attachFile')}>
                  <Paperclip size={15} /><span>{t('chat.attachFile')}</span>
                </label>
                <button className="composer-menu-item" data-testid="composer-file-reference" onClick={() => { setComposerMenuOpen(false); setFilePanelManual(true); void hostApi.piFiles.listDir(cwd).then((r) => setDirTree(r)).catch(() => setDirTree(null)); textareaRef.current?.focus(); }}><AtSign size={15} /><span>{t('chat.fileReference')}</span></button>
                <div className="composer-menu-section"><Sparkles size={14} /><span>{t('chat.skills')}</span></div>
                <div className="composer-skills-list">
                  {skills.length === 0 ? <div className="composer-menu-hint">{t('chat.noSkills')}</div> : skills.map((skill) => (
                    <button
                      className="composer-menu-item"
                      data-testid={`composer-skill-${skill.name}`}
                      key={skill.name}
                      onClick={() => { setSelectedSkill((current) => (current === skill.name ? null : skill.name)); setComposerMenuOpen(false); textareaRef.current?.focus(); }}
                    >
                      <Sparkles size={14} /><span>{skill.name}</span>{selectedSkill === skill.name && <Check size={13} />}
                    </button>
                  ))}
                </div>
                <button className="composer-menu-item" data-testid="composer-command-mode" onClick={() => { setCommandMode(true); setAttachments([]); setComposerMenuOpen(false); textareaRef.current?.focus(); }}><Terminal size={15} /><span>{t('chat.command.run')}</span></button>
              </div>
            )}
          </div>
          <div className="composer-tools">
            <button className={`composer-tool${planMode ? ' active' : ''}`} data-testid="composer-plan-toggle" title={planMode ? t('chat.planModeOn') : t('chat.planMode')} aria-pressed={planMode} onClick={() => setPlanMode((on) => !on)}><Brain size={14} /></button>
          </div>
          <button
            className="context-chip workspace-chip"
            data-testid="chat-workspace"
            title={cwd}
            onClick={() => void onChooseWorkspace()}
          >
            <Folder size={15} />
            <span>{cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}</span>
            <ChevronDown size={13} />
          </button>
          {gitBranch && (
            <div className="git-branch-wrap" ref={branchMenuRef}>
              {canSwitchBranch ? (
                <button
                  className="context-chip git-branch-chip switchable"
                  data-testid="git-branch"
                  aria-haspopup="menu"
                  aria-expanded={branchMenuOpen}
                  title={t('chat.branchSwitch.title')}
                  onClick={toggleBranchMenu}
                >
                  <GitBranch size={14} />
                  <span>{gitBranch === 'detached' ? t('chat.gitDetached') : gitBranch}</span>
                  <ChevronDown size={13} />
                </button>
              ) : (
                <span
                  className="context-chip git-branch-chip disabled"
                  data-testid="git-branch"
                  title={t('chat.branchSwitch.locked')}
                >
                  <GitBranch size={14} />
                  <span>{gitBranch === 'detached' ? t('chat.gitDetached') : gitBranch}</span>
                </span>
              )}
              {branchMenuOpen && (
                <div className="git-branch-menu" data-testid="git-branch-menu" role="menu">
                  {loadingBranches && (
                    <div className="git-branch-menu-hint">{t('chat.branchSwitch.loading')}</div>
                  )}
                  {!loadingBranches && branchList.length === 0 && (
                    <div className="git-branch-menu-hint">{t('chat.branchSwitch.empty')}</div>
                  )}
                  {!loadingBranches && branchList.map((branch) => {
                    const isCurrent = branch === gitBranch;
                    return (
                      <button
                        key={branch}
                        className={`git-branch-option${isCurrent ? ' current' : ''}`}
                        data-testid="git-branch-option"
                        data-value={branch}
                        disabled={switchingBranch}
                        onClick={() => void handleSwitchBranch(branch)}
                      >
                        <span>{branch}</span>
                        {isCurrent && <Check size={14} />}
                      </button>
                    );
                  })}
                  {isBranchDirty && (
                    <div className="git-branch-menu-dirty-hint">
                      {t('chat.branchSwitch.dirtyHint')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <span className="spacer" />
          {(models.length > 0 || model) && (
            <div className="model-menu-wrap" ref={modelMenuRef}>
              <button
                className="model-menu-trigger"
                data-testid="model-select"
                data-value={modelKey}
                aria-label={t('chat.model')}
                aria-expanded={modelMenuOpen}
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span className="model-menu-trigger-name">
                  {selectedModel ? modelDisplayName(selectedModel) : (model?.name ?? model?.id ?? t('chat.model'))}
                </span>
                {reasoning && thinkingLevel && (
                  <span className="model-menu-trigger-thinking" data-testid="model-trigger-thinking">
                    · {t(`chat.thinkingLevels.${thinkingLevel}`, { defaultValue: thinkingLevel })}
                  </span>
                )}
                <ChevronDown size={13} />
              </button>
              {modelMenuOpen && (
                <div className={`model-menu${modelMenuSection ? ' with-submenu' : ''}`} data-testid="model-menu" role="menu">
                  {modelMenuSection === 'models' && (
                    <div className="model-submenu" data-testid="model-submenu">
                      {models.length === 0 && <div className="composer-menu-hint">{t('chat.modelMenu.empty')}</div>}
                      {modelGroups.size === 1
                        ? [...modelGroups.entries()].map(([provider, providerModels]) => (
                            <div key={provider} className="model-group-items" data-testid="model-group-items">
                              {providerModels.map((m) => {
                                const value = `${m.provider}/${m.id}`;
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    className="model-option"
                                    data-testid="model-option"
                                    data-value={value}
                                    onClick={() => { setModelMenuOpen(false); applyModelSelection(value); }}
                                  >
                                    <span>{modelDisplayName(m)}</span>
                                    {value === modelKey && <Check size={14} />}
                                  </button>
                                );
                              })}
                            </div>
                          ))
                        : [...modelGroups.entries()].map(([provider, providerModels]) => {
                            const isCollapsed = collapsedProviders.has(provider);
                            return (
                              <div key={provider} className="model-group">
                                <button
                                  type="button"
                                  className="model-group-toggle"
                                  data-testid="model-group-toggle"
                                  data-value={provider}
                                  aria-expanded={!isCollapsed}
                                  aria-label={isCollapsed ? t('chat.modelMenu.expandProvider', { provider }) : t('chat.modelMenu.collapseProvider', { provider })}
                                  onClick={() => toggleProviderCollapse(provider)}
                                >
                                  <span className="model-group-toggle-title">
                                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                    <span>{provider}</span>
                                  </span>
                                  <span className="model-group-count">{providerModels.length}</span>
                                </button>
                                {!isCollapsed && (
                                  <div className="model-group-items" data-testid="model-group-items">
                                    {providerModels.map((m) => {
                                      const value = `${m.provider}/${m.id}`;
                                      return (
                                        <button
                                          key={value}
                                          type="button"
                                          className="model-option"
                                          data-testid="model-option"
                                          data-value={value}
                                          onClick={() => { setModelMenuOpen(false); applyModelSelection(value); }}
                                        >
                                          <span>{modelDisplayName(m)}</span>
                                          {value === modelKey && <Check size={14} />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                    </div>
                  )}
                  {modelMenuSection === 'thinking' && (
                    <div className="model-submenu" data-testid="model-submenu">
                      {effectiveThinkingLevels.map((level) => (
                        <button
                          key={level}
                          type="button"
                          className="model-option"
                          data-testid="thinking-option"
                          data-value={level}
                          onClick={() => {
                            setModelMenuOpen(false);
                            void paneApi.piRuntime.setThinkingLevel(level).then((result) => {
                              chatStore.getState().applyModelUpdate(result);
                            });
                          }}
                        >
                          <span>{t(`chat.thinkingLevels.${level}`, { defaultValue: level })}</span>
                          {level === thinkingLevel && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="model-menu-main">
                    <button
                      type="button"
                      className={`model-menu-row${modelMenuSection === 'models' ? ' active' : ''}`}
                      data-testid="model-menu-models"
                      onClick={() => setModelMenuSection((s) => (s === 'models' ? null : 'models'))}
                    >
                      <span>{t('chat.modelMenu.model')}</span>
                      <span className="model-menu-value">
                        {selectedModel ? modelDisplayName(selectedModel) : (model?.name ?? model?.id ?? '')}
                      </span>
                      <ChevronLeft size={13} />
                    </button>
                    {reasoning && effectiveThinkingLevels.length > 0 && (
                      <button
                        type="button"
                        className={`model-menu-row${modelMenuSection === 'thinking' ? ' active' : ''}`}
                        data-testid="model-menu-thinking"
                        disabled={isStreaming}
                        onClick={() => setModelMenuSection((s) => (s === 'thinking' ? null : 'thinking'))}
                      >
                        <span>{t('chat.thinkingLevel')}</span>
                        <span className="model-menu-value">{t(`chat.thinkingLevels.${thinkingLevel}`, { defaultValue: thinkingLevel })}</span>
                        <ChevronLeft size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
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
                <div className="usage-section-label">{t('chat.currentModelUsage')}</div>
                <div className="usage-row" data-testid="usage-context-used"><span>{t('chat.contextUsed')}</span><strong>{formatTokens(contextTokens)}</strong></div>
                <div className="usage-row" data-testid="usage-context-window"><span>{t('chat.contextWindow')}</span><strong>{formatTokens(contextWindow)}</strong></div>
                {contextUsage?.estimated && <div className="usage-note" data-testid="usage-context-estimated">{t('chat.contextEstimated')}</div>}
                {(model?.maxTokens ?? selectedModel?.maxTokens) != null && <div className="usage-row" data-testid="usage-max-output"><span>{t('chat.maxOutputTokens')}</span><strong>{formatTokens(model?.maxTokens ?? selectedModel?.maxTokens)}</strong></div>}
                <div className="usage-section-label">{t('chat.sessionTotals')}</div>
                <div className="usage-row" data-testid="usage-session-input"><span>{t('chat.inputTokens')}</span><strong>{formatTokens(usageTotals.input)}</strong></div>
                <div className="usage-row"><span>{t('chat.outputTokens')}</span><strong>{formatTokens(usageTotals.output)}</strong></div>
                {(usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && (
                  <>
                    <div className="usage-row"><span>{t('chat.cacheRead')}</span><strong>{formatTokens(usageTotals.cacheRead)}</strong></div>
                    <div className="usage-row"><span>{t('chat.cacheWrite')}</span><strong>{formatTokens(usageTotals.cacheWrite)}</strong></div>
                  </>
                )}
                {cacheStatsAvailable && totalHitRate != null && (
                  <div className="usage-row" data-testid="usage-session-cache-hit-rate"><span>{t('chat.cacheHitRate')}</span><strong>{formatHitRate(totalHitRate)}</strong></div>
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
                onClick={() => send('steer')}
                disabled={!value.trim() && attachments.length === 0}
                title={t('chat.queueSendTipSteer')}
              >
                <ArrowUp size={15} />
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
            <>
              <button
                data-testid="chat-send"
                className="send-button"
                onClick={() => send()}
                disabled={!value.trim() && attachments.length === 0}
                title={commandMode && bashing ? t('chat.command.runningHint') : sendWith === 'cmdEnter' ? t('chat.sendTipCmdEnter') : t('chat.sendTip')}
              >
                <ArrowUp size={15} />
              </button>
              {/* 压缩中/重试等待中/bash 执行中 isStreaming=false，但回合仍可中断（pi Escape 语义） */}
              {(compacting || retrying || bashing || isRunning) && (
                <button
                  data-testid="chat-stop"
                  className="send-button stop"
                  onClick={() => void abort()}
                  title={t('chat.stopTip')}
                >
                  <Square size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {previewImage && <ImageLightbox src={previewImage.url} name={previewImage.name} onClose={() => setPreviewImage(null)} />}
    </div>
  );
}
