import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FolderOpen, Info, Sparkles, Terminal, X } from 'lucide-react';
import { DEFAULT_CONTEXT_WINDOW } from '@shared/host-api/contract';
import type {
  PiModelRow,
  PiRuntimeSessionInfo,
  PiRuntimeUsageResult,
} from '@shared/host-api/contract';
import { formatOrderedAttachmentPrompt, stripAttachmentEnvelope } from '@shared/message-attachments';
import { hostApi } from '../../lib/host-api';
import { cacheHitRate, formatCost } from '../../lib/usage-stats';
import { sessionTitleFromQuestion } from '../../lib/session-title';
import { usePaneChatStore, usePaneChatStoreApi, usePaneHostApi } from './chat-store-context';
import { ImageLightbox } from './ImageLightbox';
import { QueueList } from './QueueList';
import {
  detectAtToken,
  modelDisplayName,
  resolveStreamBehavior,
  SHELL_BUILTIN_NAMES,
  type ChatInputProps,
  type FollowupBehavior,
  type SendWith,
  type StagedAttachment,
  type StagedImage,
} from './chat-input/types';
import { useFileMentions } from './chat-input/useFileMentions';
import { useSlashCommands } from './chat-input/useSlashCommands';
import { useComposerAttachments } from './chat-input/useComposerAttachments';
import { ChatInputAttachments } from './chat-input/ChatInputAttachments';
import { ChatInputMentionsPopup } from './chat-input/ChatInputMentionsPopup';
import { ChatInputSlashPopup } from './chat-input/ChatInputSlashPopup';
import { ChatInputControls } from './chat-input/ChatInputControls';

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
  const [modelMenuSection, setModelMenuSection] = useState<'models' | 'thinking' | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [modelQueries, setModelQueries] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const [composerScrollable, setComposerScrollable] = useState(false);
  const [composerScrollbarActive, setComposerScrollbarActive] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000);
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
    textareaRef.current?.focus();
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
    : contextPercent == null ? t('chat.tokenUnknown') : `${Math.round(contextPercent)}%`;
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

  const {
    atToken,
    setAtToken,
    setAtSuppressed,
    fileSelected,
    setFileSelected,
    fileMatches,
    filePanelOpen,
    filePanelManual,
    setFilePanelManual,
    dirTree,
    setDirTree,
    dirContents,
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
  });

  const {
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
  });

  const {
    previewImage,
    setPreviewImage,
    stageFiles,
    onPaste,
    removeAttachment,
  } = useComposerAttachments({
    attachments,
    setAttachments,
  });

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

  const send = (behavior?: 'steer' | 'followUp') => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    if (commandMode && bashing) return;
    const outgoingAttachments = attachments;
    const outgoing = outgoingAttachments.filter((attachment): attachment is StagedImage => attachment.kind === 'image');
    const modePrefix = planMode ? '/plan ' : selectedSkill ? `/skill:${selectedSkill} ` : '';
    const promptText = modePrefix + formatOrderedAttachmentPrompt(text, outgoingAttachments);
    setValue('');
    setAttachments(() => []);
    if (commandMode) {
      setCommandMode(false);
      if (text && !bashing) void runBash(text, commandExcludeFromContext);
      return;
    }
    if ((text.startsWith('!') || text.startsWith('！')) && outgoingAttachments.length === 0) {
      const isExcluded = text.startsWith('!!') || text.startsWith('！！');
      const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
      if (command) void runBash(command, isExcluded);
      return;
    }
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
      outgoing.map((img) => ({ type: 'image', data: img.data, mimeType: img.mediaType })),
      behavior,
    ).then(async () => {
      if (!autoTitle) return;
      const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
      const dirtyName = info?.name ? stripAttachmentEnvelope(info.name) !== info.name : false;
      if (!info?.name || dirtyName) await paneApi.piRuntime.setSessionName(autoTitle, false).catch(() => {});
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleCommandKeyDown(e)) return;
    if (handleFileKeyDown(e)) return;
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
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
      <ChatInputSlashPopup
        panelOpen={panelOpen}
        commandPanelRef={commandPanelRef}
        matches={matches}
        selected={selected}
        onPick={pick}
        commandDescription={commandDescription}
      />
      <ChatInputMentionsPopup
        filePanelOpen={filePanelOpen}
        filePanelManual={filePanelManual}
        filePanelRef={filePanelRef}
        fileMatches={fileMatches}
        fileSelected={fileSelected}
        dirTree={dirTree}
        dirContents={dirContents}
        expandedDirs={expandedDirs}
        onPickFile={pickFile}
        onToggleDir={toggleDir}
      />
      <div className="chat-input-card">
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
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          className={`${composerScrollable ? 'is-scrollable' : ''}${composerScrollbarActive ? ' scrollbar-active' : ''}`}
          value={value}
          placeholder={
            commandMode
              ? t('chat.command.placeholder')
              : sendWith === 'cmdEnter'
                ? t('chat.placeholderCmdEnter')
                : t('chat.placeholder')
          }
          onChange={(e) => {
            setValue(e.target.value);
            setSelected(0);
            setFileSelected(0);
            setAtSuppressed(false);
            setAtToken(detectAtToken(e.target.value, e.target.selectionStart ?? e.target.value.length));
          }}
          onSelect={(e) => {
            const target = e.currentTarget;
            setAtToken(detectAtToken(target.value, target.selectionStart ?? target.value.length));
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onScroll={revealComposerScrollbar}
          onWheel={revealComposerScrollbar}
          rows={1}
        />
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
            textareaRef.current?.focus();
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
          onFocusTextarea={() => textareaRef.current?.focus()}
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
