import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, FolderOpen, Info, Sparkles, Terminal, X } from 'lucide-react';
import { DEFAULT_CONTEXT_WINDOW } from '@shared/host-api/contract';
import type {
  PiModelRow,
  PiRuntimeSessionInfo,
  PiRuntimeUsageResult,
} from '@shared/host-api/contract';
import { formatOrderedAttachmentPrompt, stripAttachmentEnvelope } from '@shared/message-attachments';
import { restoreToComposer } from '../../lib/message-restore';
import { hostApi } from '../../lib/host-api';
import { cacheHitRate, formatCost } from '../../lib/usage-stats';
import { sessionTitleFromQuestion } from '../../lib/session-title';
import { FileIcon } from '../../components/FileIcon';
import { usePaneChatStore, usePaneChatStoreApi, usePaneHostApi } from './chat-store-context';
import { ImageLightbox } from './ImageLightbox';
import { QueueList } from './QueueList';
import {
  detectAtToken,
  detectSlashToken,
  formatPercent,
  modelDisplayName,
  resolveStreamBehavior,
  SHELL_BUILTIN_NAMES,
  type ChatInputProps,
  type FollowupBehavior,
  type ModelMenuSection,
  type SendWith,
  type StagedAttachment,
  type StagedImage,
} from './chat-input/types';
import { useFileMentions } from './chat-input/useFileMentions';
import { useSlashCommands } from './chat-input/useSlashCommands';
import { useComposerAttachments } from './chat-input/useComposerAttachments';
import { useInputHistory } from './chat-input/useInputHistory';
import { ContextWarningBar } from './chat-input/ContextWarningBar';
import { ChatInputAttachments } from './chat-input/ChatInputAttachments';
import { ChatInputMentionsPopup } from './chat-input/ChatInputMentionsPopup';
import { ChatInputSlashPopup } from './chat-input/ChatInputSlashPopup';
import { ChatInputControls } from './chat-input/ChatInputControls';
import {
  insertChipAtCaret,
  serializeComposer,
  populateComposer,
  getCaretCharacterOffsetWithin,
  removeChip,
  moveCaretToEnd,
} from './chat-input/composer-rich-editor';

export function ChatInput({ cwd, onChooseWorkspace, openModelMenuNonce = 0 }: ChatInputProps) {
  const { t } = useTranslation();
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
  const messages = usePaneChatStore((s) => s.messages);
  const historyMessages = usePaneChatStore((s) => s.historyMessages);
  const sessionId = usePaneChatStore((s) => s.sessionId);
  const generation = usePaneChatStore((s) => s.generation);
  const setComposerText = usePaneChatStore((s) => s.setComposerText);
  const setComposerAttachments = usePaneChatStore((s) => s.setComposerAttachments);
  const clearInputDraft = usePaneChatStore((s) => s.clearInputDraft);
  const model = usePaneChatStore((s) => s.model);
  const thinkingLevel = usePaneChatStore((s) => s.thinkingLevel);
  const availableThinkingLevels = usePaneChatStore((s) => s.availableThinkingLevels);

  const [models, setModels] = useState<PiModelRow[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [usage, setUsage] = useState<PiRuntimeUsageResult | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<PiRuntimeSessionInfo | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'slash' | 'mention';
    target: string;
    promptText: string;
    outgoing: StagedImage[];
    behavior?: 'steer' | 'followUp';
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [followupBehavior, setFollowupBehavior] = useState<FollowupBehavior>('queue');

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField((curr) => (curr === key ? null : curr)), 1500);
  };
  const [sendWith, setSendWith] = useState<SendWith>('enter');
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchList, setBranchList] = useState<string[]>([]);
  const [isBranchDirty, setIsBranchDirty] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuSection, setModelMenuSection] = useState<ModelMenuSection>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [modelQueries, setModelQueries] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const [composerScrollable, setComposerScrollable] = useState(false);
  const [composerScrollbarActive, setComposerScrollbarActive] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const usageControlRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const composerScrollTimerRef = useRef<number | null>(null);
  const composerResizeFrameRef = useRef<number | null>(null);

  const setValue = (next: string | ((current: string) => string)) => {
    const nextValue = typeof next === 'function' ? next(chatStore.getState().composerText) : next;
    setComposerText(nextValue);
    if (!nextValue && typeof window.requestAnimationFrame === 'function') {
      if (composerResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(composerResizeFrameRef.current);
      }
      composerResizeFrameRef.current = window.requestAnimationFrame(() => {
        composerResizeFrameRef.current = null;
        resizeComposer();
      });
    }
  };
  const setAttachments = (next: StagedAttachment[] | ((current: StagedAttachment[]) => StagedAttachment[])) => {
    setComposerAttachments(typeof next === 'function' ? next(chatStore.getState().composerAttachments) : next);
  };

  const focusComposer = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      moveCaretToEnd(editorRef.current);
    } else {
      textareaRef.current?.focus();
    }
  };

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000);
  };

  const resizeComposer = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const maximum = Math.max(112, Math.min(260, Math.round(window.innerHeight * 0.32)));
    editor.style.height = 'auto';
    const nextHeight = Math.max(56, Math.min(editor.scrollHeight, maximum));
    editor.style.height = `${nextHeight}px`;
    const scrollable = editor.scrollHeight > maximum + 1;
    setComposerScrollable(scrollable);
    if (!scrollable) setComposerScrollbarActive(false);
  };

  useLayoutEffect(() => {
    resizeComposer();
  }, [value]);

  useEffect(() => {
    if (editorRef.current) {
      const current = serializeComposer(editorRef.current);
      if (current !== value) {
        populateComposer(editorRef.current, value);
      }
    }
  }, [value]);

  useEffect(() => {
    const resize = () => resizeComposer();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const revealComposerScrollbar = () => {
    if (!composerScrollable) return;
    setComposerScrollbarActive(true);
    if (composerScrollTimerRef.current) window.clearTimeout(composerScrollTimerRef.current);
    composerScrollTimerRef.current = window.setTimeout(() => setComposerScrollbarActive(false), 700);
  };

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (composerScrollTimerRef.current) window.clearTimeout(composerScrollTimerRef.current);
      if (composerResizeFrameRef.current !== null) window.cancelAnimationFrame(composerResizeFrameRef.current);
    };
  }, []);

  useEffect(() => {
    setUsage(null);
  }, [sessionId, generation, paneApi]);

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

  useEffect(() => {
    if (openModelMenuNonce <= 0) return;
    setModelMenuSection('models');
    setModelMenuOpen(true);
  }, [openModelMenuNonce]);

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

  useEffect(() => {
    if (!inputDraft) return;
    setValue(inputDraft.text);
    if (inputDraft.attachments !== undefined) {
      setAttachments(inputDraft.attachments);
    }
    clearInputDraft();
    focusComposer();
  }, [inputDraft, clearInputDraft]);

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
      setModelQueries({});
    }
  }, [modelMenuOpen]);

  const groupVisibleModels = (provider: string, providerModels: PiModelRow[]) => {
    const needle = (modelQueries[provider] ?? '').trim().toLowerCase();
    if (!needle) return providerModels;
    return providerModels.filter(
      (m) => modelDisplayName(m).toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle),
    );
  };

  const toggleProviderCollapse = (provider: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const contextWindow = model?.contextWindow ?? selectedModel?.contextWindow
    ?? (contextUsage?.contextWindow && contextUsage.contextWindow > 0 ? contextUsage.contextWindow : DEFAULT_CONTEXT_WINDOW);
  const contextTokens = contextUsage?.tokens ?? null;
  const contextPercent = contextUsage?.percent != null
    ? Math.max(0, Math.min(100, contextUsage.percent))
    : contextTokens != null && contextWindow > 0
      ? Math.max(0, Math.min(100, (contextTokens / contextWindow) * 100))
      : null;
  const contextLabel = compacting || transcriptSyncing
    ? t('chat.contextSyncing')
    : contextPercent == null
      ? t('chat.tokenUnknown')
      : formatPercent(contextPercent);
  const formatTokens = (val: number | null | undefined) =>
    val == null ? t('chat.tokenUnknown') : val.toLocaleString();

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
      const state = chatStore.getState();
      if (state.startErrorCode === 'MODEL_UNAVAILABLE' && state.lastFailedSwitch) {
        void state.switchSession(state.lastFailedSwitch.path, state.lastFailedSwitch.cwd);
      }
      const nextUsage = await paneApi.piRuntime.getUsage();
      setUsage(nextUsage);
    });
  };


  type StagedItemType =
    | { type: 'attachment'; id: string }
    | { type: 'file_chip'; id: string; path: string }
    | { type: 'skill'; name: string }
    | { type: 'command' }
    | { type: 'plan' };

  const [stagedStack, setStagedStack] = useState<StagedItemType[]>([]);

  const removeChipFromEditor = (chipId?: string, chipPath?: string): boolean => {
    if (!editorRef.current) return false;
    const removed = removeChip(editorRef.current, chipId, chipPath);
    if (!removed) return false;
    const next = serializeComposer(editorRef.current);
    setValue(next);
    if (textareaRef.current) textareaRef.current.value = next;
    moveCaretToEnd(editorRef.current);
    return true;
  };

  const {
    atToken,
    setAtToken,
    atActive,
    atSuppressed,
    setAtSuppressed,
    fileList,
    isTreeMode,
    fileSelected,
    setFileSelected,
    treeSelected,
    setTreeSelected,
    fileMatches,
    filePanelOpen,
    filePanelManual,
    setFilePanelManual,
    dirTree,
    setDirTree,
    dirContents,
    setDirContents,
    expandedDirs,
    filePanelRef,
    pickFile,
    toggleDir,
    handleFileKeyDown,
  } = useFileMentions({
    cwd,
    value,
    setValue,
    setAttachments,
    textareaRef,
    onFocusEditor: focusComposer,
    onInsertMention: (relPath: string) => {
      if (editorRef.current) {
        const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        insertChipAtCaret(editorRef.current, relPath, atToken ?? undefined, chipId);
        const serialized = serializeComposer(editorRef.current);
        setValue(serialized);
        if (textareaRef.current) textareaRef.current.value = serialized;
        setStagedStack((prev) => [...prev, { type: 'file_chip', id: chipId, path: relPath }]);
      }
    },
  });

  const {
    slashToken,
    setSlashToken,
    setSlashSuppressed,
    commands,
    setCommands,
    selected,
    setSelected,
    matches,
    panelOpen,
    commandPanelRef,
    commandDescription,
    runBuiltinCommand,
    pick,
    handleCommandKeyDown,
  } = useSlashCommands({
    value,
    setValue,
    paneApi,
    chatStore,
    newSession,
    setTreeOpen,
    setModelMenuSection,
    setModelMenuOpen,
    applyModelSelection,
    models,
    showNotice,
    setSessionInfo,
    contextPercent,
    textareaRef,
    onFocusEditor: focusComposer,
    setSelectedSkill,
  });

  const {
    previewImage,
    setPreviewImage,
    stageFiles,
    onPaste,
    handleComposerDrop,
    removeAttachment,
  } = useComposerAttachments({
    attachments,
    setAttachments,
    cwd,
    value,
    setValue,
    textareaRef,
    onInsertMention: (relPath: string) => {
      if (editorRef.current) {
        const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        insertChipAtCaret(editorRef.current, relPath, undefined, chipId);
        const serialized = serializeComposer(editorRef.current);
        setValue(serialized);
        if (textareaRef.current) textareaRef.current.value = serialized;
        setStagedStack((prev) => [...prev, { type: 'file_chip', id: chipId, path: relPath }]);
      }
    },
  });

  const activeHistory = useMemo(() => {
    const sourceMessages = historyMessages.length > 0 ? historyMessages : messages;
    const list: string[] = [];
    if (commandMode) {
      for (const msg of sourceMessages) {
        if (msg.role === 'bashExecution') {
          const raw = msg.raw as { command?: string } | undefined;
          const cmd = raw?.command?.trim();
          if (cmd && (list.length === 0 || list[list.length - 1] !== cmd)) {
            list.push(cmd);
          }
        }
      }
    } else {
      for (const msg of sourceMessages) {
        if (msg.role === 'user') {
          const restored = restoreToComposer(msg);
          const text = restored.text.trim();
          if (text && (list.length === 0 || list[list.length - 1] !== text)) {
            list.push(text);
          }
        }
      }
    }
    return list;
  }, [commandMode, historyMessages, messages]);

  const {
    historyIndex,
    resetHistory,
    handleKeyDown: handleHistoryKeyDown,
  } = useInputHistory({
    value,
    setValue,
    history: activeHistory,
    textareaRef,
    slashOpen: panelOpen,
    mentionOpen: filePanelOpen,
  });

  useEffect(() => {
    resetHistory();
  }, [commandMode, resetHistory]);

  useEffect(() => {
    if (!composerMenuOpen && !usageOpen && !modelMenuOpen && !branchMenuOpen && !filePanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (composerMenuOpen && !composerMenuRef.current?.contains(target)) setComposerMenuOpen(false);
      if (usageOpen && !usageControlRef.current?.contains(target)) setUsageOpen(false);
      if (modelMenuOpen && !modelMenuRef.current?.contains(target)) setModelMenuOpen(false);
      if (branchMenuOpen && !branchMenuRef.current?.contains(target)) setBranchMenuOpen(false);
      if (filePanelOpen && !filePanelRef.current?.contains(target)) {
        setFilePanelManual(false);
        setAtSuppressed(true);
      }
    };
    const onKeyDownDoc = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setComposerMenuOpen(false);
      setUsageOpen(false);
      setModelMenuOpen(false);
      setBranchMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDownDoc);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDownDoc);
    };
  }, [composerMenuOpen, usageOpen, modelMenuOpen, branchMenuOpen, filePanelOpen, setAtSuppressed, setFilePanelManual]);

  useEffect(() => {
    const stopOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || (!isStreaming && !isRunning)) return;
      if (panelOpen || filePanelOpen || composerMenuOpen || usageOpen || modelMenuOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body && !target.closest('.chat-input-card')) return;
      event.preventDefault();
      void abort();
    };
    document.addEventListener('keydown', stopOnEscape);
    return () => document.removeEventListener('keydown', stopOnEscape);
  }, [abort, composerMenuOpen, filePanelOpen, isRunning, isStreaming, modelMenuOpen, panelOpen, usageOpen]);

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

  const executePrompt = (
    promptText: string,
    outgoing: StagedImage[],
    behavior?: 'steer' | 'followUp',
  ) => {
    const autoTitle = chatStore.getState().messages.length === 0
      ? sessionTitleFromQuestion(value.trim(), t('chat.imageSessionTitle'))
      : null;
    void prompt(
      promptText,
      outgoing.map((img) => ({ type: 'image', data: img.data, mimeType: img.mediaType })),
      behavior,
    ).then(async () => {
      if (!autoTitle) return;
      const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
      const dirtyName = info?.name ? stripAttachmentEnvelope(info.name) !== info.name : false;
      if (!info?.name || dirtyName) await paneApi.piRuntime.setSessionName(autoTitle, false).catch(() => {});
    });
  };

  const send = (behavior?: 'steer' | 'followUp') => {
    resetHistory();
    const rawInput = value.trim();
    const text = rawInput;
    if (!text && attachments.length === 0) return;
    if (text === '/' || text === '／' || text === '@') return;
    if (commandMode && bashing) return;
    const outgoingAttachments = attachments;
    const outgoing = outgoingAttachments.filter((attachment): attachment is StagedImage => attachment.kind === 'image');

    if (commandMode) {
      setValue('');
      setAttachments(() => []);
      setStagedStack([]);
      setCommandMode(false);
      if (text && !bashing) void runBash(text, commandExcludeFromContext);
      return;
    }
    if ((text.startsWith('!') || text.startsWith('！')) && outgoingAttachments.length === 0) {
      setValue('');
      setAttachments(() => []);
      setStagedStack([]);
      const isExcluded = text.startsWith('!!') || text.startsWith('！！');
      const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
      if (command) void runBash(command, isExcluded);
      return;
    }
    const isAt = (text.startsWith('@') || text.startsWith('＠')) && outgoingAttachments.length === 0;
    if (isAt) {
      const normalizedAt = text.startsWith('＠') ? '@' + text.slice(1) : text;
      const rawMention = normalizedAt.slice(1).split(/\s/)[0]?.replace(/^["']|["']$/g, '') ?? '';
      if (!rawMention) return;

      const exactFile = fileList.find(
        (f) => f === rawMention || f.toLowerCase() === rawMention.toLowerCase() || f.endsWith('/' + rawMention),
      );
      if (!exactFile) {
        const modePrefix = planMode ? '/plan ' : selectedSkill ? `/skill:${selectedSkill} ` : '';
        const promptText = modePrefix + formatOrderedAttachmentPrompt(text, outgoingAttachments);
        setConfirmDialog({
          type: 'mention',
          target: rawMention,
          promptText,
          outgoing,
          behavior,
        });
        return;
      }
    }
    const isSlash = (text.startsWith('/') || text.startsWith('／')) && outgoingAttachments.length === 0;
    if (isSlash) {
      const normalizedText = text.startsWith('／') ? '/' + text.slice(1) : text;
      const spaceIndex = normalizedText.search(/\s/);
      const rawName = (spaceIndex === -1 ? normalizedText.slice(1) : normalizedText.slice(1, spaceIndex)).toLowerCase();
      const arg = spaceIndex === -1 ? '' : normalizedText.slice(spaceIndex + 1).trim();

      if (!rawName) return;

      if (rawName === 'plan' || rawName === 'plan-mode') {
        setValue('');
        setAttachments(() => []);
        setStagedStack([]);
        setPlanMode((prev) => !prev);
        return;
      }

      if (rawName.startsWith('skill:') || rawName === 'skill') {
        const skillName = rawName.startsWith('skill:') ? rawName.slice(6) : (arg.split(/\s/)[0] ?? '');
        const promptAfterSkill = rawName.startsWith('skill:') ? arg : arg.slice(skillName.length).trim();
        if (!promptAfterSkill) {
          if (skillName) {
            setValue('');
            setAttachments(() => []);
            setStagedStack([]);
            setSelectedSkill(skillName);
          }
          return;
        }
      }

      if (SHELL_BUILTIN_NAMES.has(rawName)) {
        setValue('');
        setAttachments(() => []);
        setStagedStack([]);
        void runBuiltinCommand(rawName, arg);
        return;
      }

      const isKnownCommand =
        rawName.startsWith('skill:') ||
        rawName === 'skill' ||
        commands.some((c) => c.name.toLowerCase() === rawName);

      if (isKnownCommand) {
        const modePrefix = planMode ? '/plan ' : selectedSkill ? `/skill:${selectedSkill} ` : '';
        const promptText = modePrefix + formatOrderedAttachmentPrompt(text, outgoingAttachments);
        setValue('');
        setAttachments(() => []);
        setStagedStack([]);
        executePrompt(promptText, outgoing, behavior);
        return;
      }

      // 未知命令：弹出确认对话框，询问用户是否作为提示词直接发送给 AI
      const modePrefix = planMode ? '/plan ' : selectedSkill ? `/skill:${selectedSkill} ` : '';
      const promptText = modePrefix + formatOrderedAttachmentPrompt(text, outgoingAttachments);
      setConfirmDialog({
        type: 'slash',
        target: rawName,
        promptText,
        outgoing,
        behavior,
      });
      return;
    }

    const modePrefix = planMode ? '/plan ' : selectedSkill ? `/skill:${selectedSkill} ` : '';
    const promptText = modePrefix + formatOrderedAttachmentPrompt(text, outgoingAttachments);
    setValue('');
    setAttachments(() => []);
    setStagedStack([]);
    executePrompt(promptText, outgoing, behavior);
  };

  const prevAttachmentsRef = useRef(attachments);
  const prevSkillRef = useRef(selectedSkill);
  const prevCommandRef = useRef(commandMode);
  const prevPlanRef = useRef(planMode);

  useEffect(() => {
    if (attachments.length > prevAttachmentsRef.current.length) {
      const addedCount = attachments.length - prevAttachmentsRef.current.length;
      const newItems: StagedItemType[] = Array.from({ length: addedCount }, () => ({
        type: 'attachment' as const,
        id: Math.random().toString(36).slice(2),
      }));
      setStagedStack((prev) => [...prev, ...newItems]);
    } else if (attachments.length < prevAttachmentsRef.current.length) {
      setStagedStack((prev) => {
        let toRemove = prevAttachmentsRef.current.length - attachments.length;
        const next: StagedItemType[] = [];
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].type === 'attachment' && toRemove > 0) {
            toRemove--;
          } else {
            next.unshift(prev[i]);
          }
        }
        return next;
      });
    }
    prevAttachmentsRef.current = attachments;

    if (selectedSkill !== prevSkillRef.current) {
      if (selectedSkill) {
        setStagedStack((prev) => [
          ...prev.filter((it) => it.type !== 'skill'),
          { type: 'skill' as const, name: selectedSkill },
        ]);
      } else {
        setStagedStack((prev) => prev.filter((it) => it.type !== 'skill'));
      }
      prevSkillRef.current = selectedSkill;
    }

    if (commandMode !== prevCommandRef.current) {
      if (commandMode) {
        setStagedStack((prev) => [
          ...prev.filter((it) => it.type !== 'command'),
          { type: 'command' as const },
        ]);
      } else {
        setStagedStack((prev) => prev.filter((it) => it.type !== 'command'));
      }
      prevCommandRef.current = commandMode;
    }

    if (planMode !== prevPlanRef.current) {
      if (planMode) {
        setStagedStack((prev) => [
          ...prev.filter((it) => it.type !== 'plan'),
          { type: 'plan' as const },
        ]);
      } else {
        setStagedStack((prev) => prev.filter((it) => it.type !== 'plan'));
      }
      prevPlanRef.current = planMode;
    }
  }, [attachments, selectedSkill, commandMode, planMode]);

  const cancelLastStagedItem = (): boolean => {
    for (let i = stagedStack.length - 1; i >= 0; i--) {
      const item = stagedStack[i];
      if (item.type === 'file_chip') {
        const removed = removeChipFromEditor(item.id, item.path);
        setStagedStack((prev) => prev.filter((_, idx) => idx !== i));
        if (removed) {
          return true;
        }
        continue;
      }
      if (item.type === 'skill' && selectedSkill) {
        setSelectedSkill(null);
        setStagedStack((prev) => prev.filter((_, idx) => idx !== i));
        return true;
      }
      if (item.type === 'attachment' && attachments.length > 0) {
        setAttachments((prev) => prev.slice(0, -1));
        setStagedStack((prev) => prev.filter((_, idx) => idx !== i));
        return true;
      }
      if (item.type === 'command' && commandMode) {
        setCommandMode(false);
        setStagedStack((prev) => prev.filter((_, idx) => idx !== i));
        return true;
      }
      if (item.type === 'plan' && planMode) {
        setPlanMode(false);
        setStagedStack((prev) => prev.filter((_, idx) => idx !== i));
        return true;
      }
    }

    if (removeChipFromEditor()) {
      return true;
    }
    if (selectedSkill) {
      setSelectedSkill(null);
      return true;
    }
    if (attachments.length > 0) {
      setAttachments((prev) => prev.slice(0, -1));
      return true;
    }
    if (commandMode) {
      setCommandMode(false);
      return true;
    }
    if (planMode) {
      setPlanMode(false);
      return true;
    }

    // 防误触保护：保留已输入的提示词文本，不再清空 value
    return false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (handleCommandKeyDown(e)) return;
    if (handleFileKeyDown(e)) return;
    if (handleHistoryKeyDown(e)) return;
    if (e.key === 'Backspace') {
      const textarea = textareaRef.current;
      if (textarea && textarea.selectionStart === textarea.selectionEnd) {
        const cursor = textarea.selectionStart ?? 0;
        const currentVal = textarea.value;
        const textBeforeCursor = currentVal.slice(0, cursor);
        const match = textBeforeCursor.match(
          /(?:^|[^a-zA-Z0-9_])(@(?:"[^"\n]+"|[a-zA-Z0-9_./\\-]+(?:\.[a-zA-Z0-9_-]+)+|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./\\-]+)\s?)$/,
        );
        if (match) {
          e.preventDefault();
          const tokenToDelete = match[1];
          const deleteStart = cursor - tokenToDelete.length;
          const nextVal = currentVal.slice(0, deleteStart) + currentVal.slice(cursor);
          setValue(nextVal);
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(deleteStart, deleteStart);
          });
          return;
        }
      }
    }
    if (e.key === 'Escape') {
      if (cancelLastStagedItem()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key !== 'Enter') return;
    const trimmed = value.trim();
    if (trimmed === '/' || trimmed === '／' || trimmed === '@') {
      e.preventDefault();
      return;
    }
    if (sendWith === 'cmdEnter') {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      send(resolveStreamBehavior(followupBehavior, e.altKey));
      return;
    }
    if (!e.shiftKey) {
      e.preventDefault();
      send(resolveStreamBehavior(followupBehavior, e.altKey));
    }
  };


  useEffect(() => {
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (confirmDialog) {
        e.preventDefault();
        e.stopPropagation();
        setConfirmDialog(null);
        focusComposer();
        return;
      }
      if (sessionInfo) {
        e.preventDefault();
        e.stopPropagation();
        setSessionInfo(null);
        return;
      }
      if (previewImage) {
        e.preventDefault();
        e.stopPropagation();
        setPreviewImage(null);
        return;
      }
      if (modelMenuOpen) {
        e.preventDefault();
        e.stopPropagation();
        setModelMenuOpen(false);
        return;
      }
      if (branchMenuOpen) {
        e.preventDefault();
        e.stopPropagation();
        setBranchMenuOpen(false);
        return;
      }
      if (composerMenuOpen) {
        e.preventDefault();
        e.stopPropagation();
        setComposerMenuOpen(false);
        return;
      }
      if (panelOpen || filePanelOpen) {
        return;
      }

      if (cancelLastStagedItem()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [
    confirmDialog,
    sessionInfo,
    previewImage,
    modelMenuOpen,
    branchMenuOpen,
    composerMenuOpen,
    panelOpen,
    filePanelOpen,
    value,
    stagedStack,
    selectedSkill,
    attachments,
    commandMode,
    planMode,
  ]);

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
          role="dialog"
          aria-modal="true"
          aria-label={t('chat.sessionInfo.title')}
          data-testid="session-info-dialog"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSessionInfo(null);
          }}
        >
          <div className="session-info-modal" data-testid="session-info-modal">
            <div className="session-info-header">
              <div className="session-info-title-wrap">
                <Info size={16} style={{ color: 'var(--accent)' }} />
                <span>{t('chat.sessionInfo.title')}</span>
                {sessionInfo.name && (
                  <span className="session-info-name-chip" title={sessionInfo.name}>
                    {sessionInfo.name}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn-icon"
                data-testid="session-info-close"
                onClick={() => setSessionInfo(null)}
                aria-label={t('common.close')}
              >
                <X size={15} />
              </button>
            </div>
            <div className="session-info-body">
              <div className="session-info-section">
                {sessionInfo.name && (
                  <div className="usage-row">
                    <span>{t('chat.sessionInfo.name')}</span>
                    <strong>{sessionInfo.name}</strong>
                  </div>
                )}
                <div className="usage-row">
                  <span>{t('chat.sessionInfo.id')}</span>
                  <div className="session-info-val-wrap">
                    <code className="session-info-id" title={sessionInfo.sessionId}>
                      {sessionInfo.sessionId}
                    </code>
                    <button
                      type="button"
                      className={`session-info-action-btn${copiedField === 'id' ? ' copied' : ''}`}
                      title={copiedField === 'id' ? t('chat.sessionInfo.copied') : t('chat.sessionInfo.copyId')}
                      onClick={() => copyText('id', sessionInfo.sessionId)}
                    >
                      {copiedField === 'id' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
                <div className="usage-row">
                  <span>{t('chat.sessionInfo.file')}</span>
                  <div className="session-info-val-wrap">
                    {sessionInfo.isSaved === false && (
                      <span
                        className="session-info-badge session-info-unsaved-badge"
                        title={t('chat.sessionInfo.notSavedYetHint')}
                      >
                        {t('chat.sessionInfo.notSavedYet')}
                      </span>
                    )}
                    <code
                      className="session-info-id session-info-file-path"
                      title={
                        sessionInfo.isSaved === false
                          ? `${sessionInfo.sessionFile ?? cwd} (${t('chat.sessionInfo.notSavedYetHint')})`
                          : (sessionInfo.sessionFile ?? cwd)
                      }
                    >
                      {sessionInfo.sessionFile ?? cwd}
                    </code>
                    <button
                      type="button"
                      className={`session-info-action-btn${copiedField === 'file' ? ' copied' : ''}`}
                      title={copiedField === 'file' ? t('chat.sessionInfo.copied') : t('chat.sessionInfo.copyPath')}
                      onClick={() => copyText('file', sessionInfo.sessionFile ?? cwd)}
                    >
                      {copiedField === 'file' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <button
                      type="button"
                      className="session-info-action-btn"
                      title={
                        sessionInfo.isSaved === false
                          ? t('chat.sessionInfo.notSavedYetHint')
                          : t('chat.sessionInfo.showInFolder')
                      }
                      onClick={() => {
                        void hostApi.shell.showInFolder(sessionInfo.sessionFile ?? cwd);
                      }}
                    >
                      <FolderOpen size={13} />
                    </button>
                  </div>
                </div>
                {sessionInfo.model && (
                  <div className="usage-row">
                    <span>{t('chat.sessionInfo.model')}</span>
                    <span className="session-info-badge">
                      {sessionInfo.model.name ??
                        `${sessionInfo.model.provider}/${sessionInfo.model.id}`}
                    </span>
                  </div>
                )}
              </div>

              <div className="session-info-section">
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
              </div>

              <div className="session-info-section">
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
                  <strong style={{ color: 'var(--accent)' }}>{formatTokens(sessionInfo.tokens.total)}</strong>
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
        </div>
      )}
      {confirmDialog && (
        <div
          className="tree-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            confirmDialog.type === 'slash'
              ? t('chat.confirmSlashSend.title')
              : t('chat.confirmMentionSend.title')
          }
          data-testid={confirmDialog.type === 'slash' ? 'confirm-slash-dialog' : 'confirm-mention-dialog'}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfirmDialog(null);
              focusComposer();
            }
          }}
        >
          <div className="session-info-modal" style={{ maxWidth: 440 }}>
            <div className="session-info-header">
              <div className="session-info-title-wrap">
                <AlertTriangle size={16} style={{ color: 'var(--accent)' }} />
                <span>
                  {confirmDialog.type === 'slash'
                    ? t('chat.confirmSlashSend.title')
                    : t('chat.confirmMentionSend.title')}
                </span>
              </div>
              <button
                type="button"
                className="btn-icon"
                data-testid="confirm-dialog-close"
                onClick={() => {
                  setConfirmDialog(null);
                  focusComposer();
                }}
                aria-label={t('common.close')}
              >
                <X size={15} />
              </button>
            </div>
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              {confirmDialog.type === 'slash'
                ? t('chat.confirmSlashSend.description', { command: `/${confirmDialog.target}` })
                : t('chat.confirmMentionSend.description', { mention: `@${confirmDialog.target}` })}
            </div>
            <div className="confirm-slash-actions">
              <button
                type="button"
                className="confirm-slash-btn-cancel"
                data-testid="confirm-dialog-cancel"
                autoFocus
                onClick={() => {
                  setConfirmDialog(null);
                  focusComposer();
                }}
              >
                {confirmDialog.type === 'slash'
                  ? t('chat.confirmSlashSend.cancel')
                  : t('chat.confirmMentionSend.cancel')}
              </button>
              <button
                type="button"
                className="confirm-slash-btn-send"
                data-testid="confirm-dialog-submit"
                onClick={() => {
                  const modalData = confirmDialog;
                  setValue('');
                  setAttachments(() => []);
                  setConfirmDialog(null);
                  executePrompt(modalData.promptText, modalData.outgoing, modalData.behavior);
                }}
              >
                {confirmDialog.type === 'slash'
                  ? t('chat.confirmSlashSend.send')
                  : t('chat.confirmMentionSend.send')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ChatInputSlashPopup
        panelOpen={panelOpen}
        commandPanelRef={commandPanelRef}
        matches={matches}
        selected={selected}
        onPick={pick}
        commandDescription={commandDescription}
        onClose={() => {
          setValue('');
          focusComposer();
        }}
      />
      <ChatInputMentionsPopup
        filePanelOpen={filePanelOpen}
        filePanelManual={filePanelManual}
        isTreeMode={isTreeMode}
        filePanelRef={filePanelRef}
        fileMatches={fileMatches}
        fileSelected={fileSelected}
        treeSelected={treeSelected}
        dirTree={dirTree}
        dirContents={dirContents}
        expandedDirs={expandedDirs}
        onPickFile={pickFile}
        onToggleDir={toggleDir}
        onSelectTreeIndex={setTreeSelected}
        onClose={() => {
          setAtSuppressed(true);
          setFilePanelManual(false);
          if (atToken) {
            setValue((current) => current.slice(0, atToken.start) + current.slice(atToken.end));
            setAtToken(null);
          }
          focusComposer();
        }}
      />
      <ContextWarningBar
        contextPercent={contextPercent}
        compacting={compacting}
        onCompact={() => void paneApi.piRuntime.compact()}
      />
      <div
        className="chat-input-card chat-input-composer"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleComposerDrop}
      >
        <ChatInputAttachments
          attachments={attachments}
          onRemove={removeAttachment}
          onPreviewImage={setPreviewImage}
        />
        {commandMode && (
          <div className="command-mode-bar" data-testid="command-mode-bar">
            <span className="command-mode-label">
              <Terminal size={13} />
              {t('chat.command.mode')}
            </span>
            <button
              type="button"
              className={`command-context-toggle${commandExcludeFromContext ? '' : ' in-context'}`}
              data-testid="command-context-toggle"
              title={
                commandExcludeFromContext
                  ? t('chat.command.includeContext')
                  : t('chat.command.excludeContext')
              }
              onClick={() => setCommandExcludeFromContext(!commandExcludeFromContext)}
            >
              {commandExcludeFromContext ? t('chat.bash.excluded') : t('chat.command.inContext')}
            </button>
            <button
              type="button"
              className="command-mode-exit"
              data-testid="command-mode-exit"
              aria-label={t('chat.command.exit')}
              title={t('chat.command.exit')}
              onClick={() => setCommandMode(false)}
            >
              <X size={13} />
            </button>
          </div>
        )}
        {selectedSkill && (
          <div className="skill-mode-bar" data-testid="skill-mode-bar">
            <span className="skill-mode-label">
              <Sparkles size={13} />/skill:{selectedSkill}
            </span>
            <button
              type="button"
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
        <div
          className="composer-rich-wrapper"
          onClick={(e) => {
            const removeBtn = (e.target as HTMLElement).closest('.composer-inline-chip-remove');
            if (removeBtn && editorRef.current) {
              const chip = removeBtn.closest('.composer-inline-chip');
              const chipId = chip?.getAttribute('data-chip-id');
              const chipPath = chip?.getAttribute('data-file');
              if (chipId) {
                setStagedStack((prev) => prev.filter((it) => it.type !== 'file_chip' || it.id !== chipId));
              } else if (chipPath) {
                setStagedStack((prev) => {
                  let found = -1;
                  for (let i = prev.length - 1; i >= 0; i--) {
                    if (prev[i].type === 'file_chip' && (prev[i] as { path: string }).path === chipPath) {
                      found = i;
                      break;
                    }
                  }
                  return found === -1 ? prev : prev.filter((_, i) => i !== found);
                });
              }
              if (chip?.nextSibling && chip.nextSibling.nodeType === Node.TEXT_NODE && /^\s+$/.test(chip.nextSibling.textContent || '')) {
                chip.nextSibling.remove();
              }
              chip?.remove();
              const next = serializeComposer(editorRef.current);
              setValue(next);
              if (textareaRef.current) textareaRef.current.value = next;
              return;
            }
            editorRef.current?.focus();
          }}
        >
          <div
            ref={editorRef}
            contentEditable
            data-testid="chat-input-editor"
            className={`composer-rich-editor${composerScrollable ? ' is-scrollable' : ''}${composerScrollbarActive ? ' scrollbar-active' : ''}`}
            data-placeholder={
              commandMode
                ? t('chat.command.placeholder')
                : sendWith === 'cmdEnter'
                  ? t('chat.placeholderCmdEnter')
                  : t('chat.placeholder')
            }
            onInput={() => {
              if (!editorRef.current) return;
              if (historyIndex !== -1) {
                resetHistory();
              }
              const next = serializeComposer(editorRef.current);
              setValue(next);
              if (textareaRef.current) textareaRef.current.value = next;
              setSelected(0);
              setFileSelected(0);
              setAtSuppressed(false);
              setSlashSuppressed(false);
              const caret = getCaretCharacterOffsetWithin(editorRef.current);
              setAtToken(detectAtToken(next, caret));
              setSlashToken(detectSlashToken(next, caret));
            }}
            onSelect={() => {
              if (!editorRef.current) return;
              const next = serializeComposer(editorRef.current);
              const caret = getCaretCharacterOffsetWithin(editorRef.current);
              setAtToken(detectAtToken(next, caret));
              setSlashToken(detectSlashToken(next, caret));
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (handleCommandKeyDown(e as unknown as KeyboardEvent<HTMLTextAreaElement>)) return;
              if (handleFileKeyDown(e as unknown as KeyboardEvent<HTMLTextAreaElement>)) return;
              if (handleHistoryKeyDown(e as unknown as KeyboardEvent<HTMLTextAreaElement>)) return;
              if (e.key === 'Escape') {
                if (cancelLastStagedItem()) {
                  e.preventDefault();
                  return;
                }
              }
              if (e.key !== 'Enter') return;
              const text = serializeComposer(editorRef.current!).trim();
              if (text === '/' || text === '／' || text === '@') {
                e.preventDefault();
                return;
              }
              if (sendWith === 'cmdEnter') {
                if (!e.metaKey && !e.ctrlKey) return;
                e.preventDefault();
                send(resolveStreamBehavior(followupBehavior, e.altKey));
                return;
              }
              if (!e.shiftKey) {
                e.preventDefault();
                send(resolveStreamBehavior(followupBehavior, e.altKey));
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              const images = files.filter((f) => f.type.startsWith('image/'));
              if (images.length > 0) {
                e.preventDefault();
                void stageFiles(images);
              }
            }}
            onScroll={revealComposerScrollbar}
            onWheel={revealComposerScrollbar}
          />
          <textarea
            ref={textareaRef}
            data-testid="chat-input"
            className="composer-sync-textarea"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (editorRef.current) {
                populateComposer(editorRef.current, e.target.value);
                const caret = e.target.value.length;
                setAtToken(detectAtToken(e.target.value, caret));
                setSlashToken(detectSlashToken(e.target.value, caret));
              }
            }}
            onKeyDown={onKeyDown}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
        <ChatInputControls
          cwd={cwd}
          onChooseWorkspace={onChooseWorkspace}
          composerMenuRef={composerMenuRef}
          composerMenuOpen={composerMenuOpen}
          setComposerMenuOpen={setComposerMenuOpen}
          onStageFiles={(files) => void stageFiles(files)}
          onOpenFileReference={() => {
            setFilePanelManual(true);
            void hostApi.piFiles.listDir(cwd).then((r) => setDirTree(r)).catch(() => setDirTree(null));
            focusComposer();
          }}
          skills={skills}
          selectedSkill={selectedSkill}
          setSelectedSkill={setSelectedSkill}
          setCommandMode={setCommandMode}
          setAttachments={setAttachments}
          planMode={planMode}
          setPlanMode={setPlanMode}
          gitBranch={gitBranch}
          canSwitchBranch={canSwitchBranch}
          branchMenuRef={branchMenuRef}
          branchMenuOpen={branchMenuOpen}
          toggleBranchMenu={toggleBranchMenu}
          loadingBranches={loadingBranches}
          branchList={branchList}
          switchingBranch={switchingBranch}
          isBranchDirty={isBranchDirty}
          onSwitchBranch={handleSwitchBranch}
          models={models}
          model={model}
          selectedModel={selectedModel}
          modelKey={modelKey}
          modelMenuRef={modelMenuRef}
          modelMenuOpen={modelMenuOpen}
          setModelMenuOpen={setModelMenuOpen}
          modelMenuSection={modelMenuSection}
          setModelMenuSection={setModelMenuSection}
          modelGroups={modelGroups}
          collapsedProviders={collapsedProviders}
          toggleProviderCollapse={toggleProviderCollapse}
          modelQueries={modelQueries}
          setModelQueries={setModelQueries}
          groupVisibleModels={groupVisibleModels}
          applyModelSelection={applyModelSelection}
          onSelectThinkingLevel={(level) => {
            void paneApi.piRuntime.setThinkingLevel(level).then((result) => {
              chatStore.getState().applyModelUpdate(result);
            });
          }}
          onSelectContextWindow={(cw) => {
            void paneApi.piRuntime.setContextWindow(cw).then((result) => {
              chatStore.getState().applyModelUpdate(result);
            });
          }}
          reasoning={reasoning}
          thinkingLevel={thinkingLevel}
          effectiveThinkingLevels={effectiveThinkingLevels}
          isStreaming={isStreaming}
          isRunning={isRunning}
          compacting={compacting}
          retrying={retrying}
          bashing={bashing}
          commandMode={commandMode}
          sendWith={sendWith}
          value={value}
          attachmentsLength={attachments.length}
          usageControlRef={usageControlRef}
          usageOpen={usageOpen}
          setUsageOpen={setUsageOpen}
          contextLabel={contextLabel}
          contextTokens={contextTokens}
          contextWindow={contextWindow}
          contextUsage={contextUsage}
          usageTotals={usageTotals}
          cacheStatsAvailable={cacheStatsAvailable}
          totalHitRate={totalHitRate}
          lastTurnHitRate={lastTurnHitRate}
          formatTokens={formatTokens}
          onSend={send}
          onAbort={() => void abort()}
          onFocusTextarea={focusComposer}
        />
      </div>
      {previewImage && (
        <ImageLightbox
          src={previewImage.url}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}
