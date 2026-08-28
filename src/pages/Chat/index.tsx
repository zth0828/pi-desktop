import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Check, ChevronRight, PanelRight, X } from 'lucide-react';
import { stripAttachmentEnvelope } from '@shared/message-attachments';
import { parseProviderError, PROVIDER_ERROR_HINT_KEYS } from '@shared/provider-error';
import { collectCacheMisses } from '../../lib/cache-stats';
import { cacheHitRate, summarizeUsage } from '../../lib/usage-stats';
import { hostApi } from '../../lib/host-api';
import { matchHostInvokeTimeout } from '../../lib/host-api-client';
import { onHostEvent } from '../../lib/host-events';
import { SESSION_REPLACEMENT_TIMEOUT } from '../../lib/session-binding';
import { sessionTitleFromQuestion } from '../../lib/session-title';
import { workspaceErrorMessage } from '../../lib/workspace-error';
import { timingMark } from '../../lib/timing';
import { groupLogicalTurns, groupTurnStages, turnDurationMs, turnFinalResponseIndex } from '../../lib/turn-changes';
import { usePaneChatStore, usePaneChatStoreApi, usePaneHostApi } from './chat-store-context';
import { PaneLayout } from '../../components/PaneLayout';
import { ExtensionUiDialog } from '../../components/ExtensionUiDialog';
import { ChatGreeting } from './ChatGreeting';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';
import { MessageNavRail, truncateRailText, type RailAnchor } from './MessageNavRail';
import { StatusBar } from './StatusBar';
import { ReviewPanel } from './ReviewPanel';
import { TreeDialog } from './TreeDialog';
import { TurnChangesCard } from './TurnChangesCard';

function SessionTitleBar({ onClosePane }: { onClosePane?: () => void }) {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const setReviewOpen = usePaneChatStore((s) => s.setReviewOpen);
  const workspaceOpen = usePaneChatStore((s) => s.workspaceOpen);
  const reviewOpen = usePaneChatStore((s) => s.reviewOpen);
  const setWorkspaceOpen = usePaneChatStore((s) => s.setWorkspaceOpen);
  const started = usePaneChatStore((s) => s.started);
  const sessionId = usePaneChatStore((s) => s.sessionId);
  const firstUserMessage = usePaneChatStore((s) =>
    (s.historyMessages.length > 0 ? s.historyMessages : s.messages).find((entry) => entry.role === 'user'),
  );
  const firstUserQuestion = firstUserMessage?.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ') ?? '';
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isStreaming = usePaneChatStore((s) => s.isStreaming);
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (!started) return;
    const refresh = () => {
      void paneApi.piRuntime.getSessionInfo().then((info) => setName(info?.name ?? ''));
    };
    refresh();
    // 侧栏/其他窗口改名走 sessionsChanged(rename) 即时刷新；payload 无会话标识，
    // rename 是低频操作直接刷新不过滤。onHostEvent 是窗口级订阅，多面板各自成对订阅。
    const offRename = onHostEvent('piRuntime', 'sessionsChanged', ({ reason }) => {
      if (reason === 'rename') refresh();
    });
    // 低频兜底：pi 侧自动命名等无事件通道的改名路径只能靠轮询发现。
    // 原 1s 常驻轮询降为 30s——N 面板 N 条 1s 定时器是纯空转，30s 开销可忽略。
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      offRename();
      window.clearInterval(timer);
    };
  }, [started, sessionId, paneApi]);
  useEffect(() => {
    // 流式中改名（/name、自动命名）pi 不推事件（流中推全量会丢 partial），
    // 流结束时状态已含新名：isStreaming true→false 翻转时刷新一次覆盖该盲区。
    if (wasStreaming.current && !isStreaming) {
      void paneApi.piRuntime.getSessionInfo().then((info) => setName(info?.name ?? ''));
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, paneApi]);
  const displayName = name || (firstUserMessage
    ? sessionTitleFromQuestion(firstUserQuestion, t('chat.imageSessionTitle'))
    : '');
  const beginRename = () => { setDraft(name || (firstUserMessage ? displayName : '')); setEditing(true); };
  const saveRename = async () => {
    const next = draft.trim();
    if (!next) { setEditing(false); return; }
    const result = await paneApi.piRuntime.setSessionName(next);
    if (result.success) setName(result.name ?? next);
    setEditing(false);
  };
  return (
    // 单面板（onClosePane 为空）时加 session-titlebar-top：macOS 上该标题条
    // 固定到窗口顶部（平台样式在 CSS 里按 .is-macos 限定，Windows 不受影响）；
    // 多面板时留在内容区顶部，避免多个标题条叠加。
    <div className={`session-titlebar${onClosePane ? '' : ' session-titlebar-top'}`} data-testid="session-titlebar">
      <div className="session-title">
        {editing ? (
          <>
            <input autoFocus value={draft} aria-label={t('chat.renameSession')} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setEditing(false); }} />
            <button className="icon-button" title={t('chat.saveRename')} onClick={() => void saveRename()}><Check size={15} /></button>
            <button className="icon-button" title={t('chat.cancelRename')} onClick={() => setEditing(false)}><X size={15} /></button>
          </>
        ) : displayName ? (
          <button className="session-title-button" data-testid="session-title-button" onClick={beginRename} title={t('chat.renameSession')}>
            <span>{displayName}</span>
          </button>
        ) : (
          // 尚未发送任何内容：不展示「未命名会话」，标题区留空（会话名只在真正创建会话后出现）
          <span className="session-title-empty" data-testid="session-title-empty" aria-hidden="true" />
        )}
      </div>
      <div className="session-title-actions">
        <button
          className={`icon-button${workspaceOpen || reviewOpen ? ' active' : ''}`}
          data-testid="workspace-toggle"
          title={t('workspace.toggle')}
          aria-pressed={workspaceOpen || reviewOpen}
          onClick={() => {
            // 两个面板共用右侧工作台：任一开着的收起要同时关掉，否则评审开着时按钮失效
            if (workspaceOpen || reviewOpen) {
              setWorkspaceOpen(false);
              setReviewOpen(false);
            } else {
              setWorkspaceOpen(true);
            }
          }}
        >
          <PanelRight size={17} />
        </button>
        {onClosePane && (
          <button
            className="icon-button"
            data-testid="pane-close"
            title={t('chat.closePane')}
            aria-label={t('chat.closePane')}
            onClick={onClosePane}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function ExtensionWidgets({ placement }: { placement: 'aboveEditor' | 'belowEditor' }) {
  const extensionUi = usePaneChatStore((s) => s.extensionUi);
  const visible = extensionUi?.widgets.filter((widget) => widget.placement === placement) ?? [];
  if (visible.length === 0) return null;
  return (
    <div className={`extension-widgets ${placement}`} data-testid={`extension-widgets-${placement}`}>
      {visible.map((widget) => (
        <div className="extension-widget" data-testid="extension-widget" key={widget.key}>
          {widget.lines.map((line, index) => <div key={index}>{line}</div>)}
        </div>
      ))}
    </div>
  );
}

type Props = {
  searchTarget?: { sessionId: string; messageIndex: number; nonce: number };
  onSearchTargetHandled?: () => void;
  /** 窗口首个面板：仅它执行 ?session= attach / workspaceCwd 恢复与工作区选择 */
  primary?: boolean;
  /** ?session= attach 目标（PaneLayout 顶层读一次，仅 primary 面板使用） */
  attachSession?: string | null;
  /** 分栏拖入的 attach 重试目标（splitAt/drop 带入的非 primary 面板） */
  attachTarget?: { sessionPath: string; cwd?: string } | null;
  /** 关闭面板（仅多面板时由 PaneLayout 传入；最后一个面板不可关） */
  onClosePane?: () => void;
};

export function ChatPane({ searchTarget, onSearchTargetHandled, primary, attachSession, attachTarget, onClosePane }: Props) {
  const { t } = useTranslation();
  const chatStore = usePaneChatStoreApi();
  const [cwd, setCwd] = useState<string | undefined>();
  const [workspaceError, setWorkspaceError] = useState<string>();
  // 模型不可用 banner 的「选择模型」入口信号（nonce 递增：重复点击每次都触发打开）
  const [modelMenuNonce, setModelMenuNonce] = useState(0);
  const started = usePaneChatStore((s) => s.started);
  const starting = usePaneChatStore((s) => s.starting);
  const startError = usePaneChatStore((s) => s.startError);
  const startErrorCode = usePaneChatStore((s) => s.startErrorCode);
  const runtimeError = usePaneChatStore((s) => s.runtimeError);
  const lastFailedSwitch = usePaneChatStore((s) => s.lastFailedSwitch);
  const dismissRuntimeError = usePaneChatStore((s) => s.dismissRuntimeError);
  const dismissStartError = usePaneChatStore((s) => s.dismissStartError);
  const messages = usePaneChatStore((s) => s.messages);
  const historyMessages = usePaneChatStore((s) => s.historyMessages);
  const bashDraft = usePaneChatStore((s) => s.bashDraft);
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const isStreaming = usePaneChatStore((s) => s.isStreaming);
  // 压缩后优先使用完整分支历史；流式期间仍用事件增量列表，避免等待快照时丢掉最新回复。
  const displayMessages = isStreaming || historyMessages.length === 0 ? messages : historyMessages;
  const turnStats = usePaneChatStore((s) => s.turnStats);
  const sessionId = usePaneChatStore((s) => s.sessionId);
  const workspaceVisible = usePaneChatStore((s) => s.workspaceOpen || s.reviewOpen);
  const transcriptSyncing = usePaneChatStore((s) => s.transcriptSyncing);
  const start = usePaneChatStore((s) => s.start);
  const switchSession = usePaneChatStore((s) => s.switchSession);
  // 独立会话窗口的 attach 目标由 PaneLayout 顶层读取一次后通过 prop 传入（
  // 避免每个面板各自读 location.search）
  // 跨项目切换会话时以 runtime 的实际 cwd 为准
  const activeCwd = usePaneChatStore((s) => (s.started ? s.cwd : undefined));
  const effectiveCwd = activeCwd ?? cwd;
  const listRef = useRef<HTMLDivElement>(null);
  // 一个 user 问题对应一个完整回合；完成后默认收起 thinking/阶段文本/工具调用。
  const [expandedTurns, setExpandedTurns] = useState<Record<number, boolean>>({});
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState<number>();
  const stickToBottomRef = useRef(true);
  // 会话切换后的滚动复位窗口：期间忽略顶部瞬态滚动，防止 stickToBottom 被误置为 false
  const scrollResetRef = useRef(false);
  useEffect(() => {
    setExpandedTurns({});
    setExpandedStages({});
    setShowScrollToBottom(false);
    stickToBottomRef.current = true;
    // 搜索定位跳转由 searchTarget 对齐逻辑接管，不强制回底部
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (searchTarget?.sessionId === sessionId) return;
    // 进入/切换会话：直接定位到最新消息（底部）。列表内容替换后 scrollTop 会留在
    // 顶部，若不主动复位会停在第一条输入处；复位窗口内的 affordance 计算不改变 stick。
    const list = listRef.current;
    if (list) {
      scrollResetRef.current = true;
      list.scrollTop = list.scrollHeight;
      // 图片/代码块等延迟布局后再钉一次底
      const raf = requestAnimationFrame(() => {
        const el = listRef.current;
        if (el && scrollResetRef.current) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event('scroll'));
        }
      });
      const settle = window.setTimeout(() => {
        const el = listRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event('scroll'));
        }
      }, 100);
      const release = window.setTimeout(() => {
        scrollResetRef.current = false;
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        updateScrollAffordance();
      }, 400);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(settle);
        window.clearTimeout(release);
        scrollResetRef.current = false;
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  const railAnchors = useMemo<RailAnchor[]>(() => {
    let n = 0;
    return displayMessages.flatMap((m, i) =>
      m.role === 'user' ? [{
        id: `chat-msg-${i}`,
        n: (n += 1),
        // 附件信封（<attachments>…）不属于问题文字，rail 悬浮预览里同样不展示
        question: truncateRailText(
          stripAttachmentEnvelope(
            m.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text ?? '')
              .join(' '),
          )
            .replace(/\s+/g, ' ')
            .trim(),
        ),
      }] : [],
    );
  }, [displayMessages]);

  const compactionAnchors = useMemo(() => {
    let n = 0;
    return displayMessages.flatMap((message, index) => {
      if (message.role !== 'compactionSummary') return [];
      const raw = message.raw as { summary?: string; content?: string } | undefined;
      const summary = raw?.summary ?? raw?.content ?? message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return [{ id: `chat-msg-${index}`, n: (n += 1), summary: truncateRailText(summary) }];
    });
  }, [displayMessages]);

  // 缓存失效检测（pi cache-stats 口径）：按下标分发给 assistant 消息尾部警告
  const cacheMisses = useMemo(() => collectCacheMisses(displayMessages), [displayMessages]);
  const sessionCacheHitRate = useMemo(() => cacheHitRate(summarizeUsage(displayMessages)), [displayMessages]);

  const latestFinalResponseIndex = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i -= 1) {
      const message = displayMessages[i];
      if (message.role === 'assistant' && message.content.some((block) => block.type === 'text' && block.text?.trim())) return i;
    }
    return -1;
  }, [displayMessages]);

  const logicalTurns = useMemo(() => groupLogicalTurns(displayMessages), [displayMessages]);

  useEffect(() => {
    if (!searchTarget || searchTarget.sessionId !== sessionId || !displayMessages[searchTarget.messageIndex]) return;
    const targetIndex = searchTarget.messageIndex;
    const targetTurn = logicalTurns.find((turn) => targetIndex >= turn.startIndex && targetIndex <= turn.endIndex);
    if (targetTurn) {
      setExpandedTurns((current) => ({ ...current, [targetTurn.startIndex]: true }));
      const finalIndex = turnFinalResponseIndex(displayMessages, targetTurn);
      const stageIndices = Array.from(
        { length: targetTurn.endIndex - targetTurn.startIndex },
        (_, offset) => targetTurn.startIndex + 1 + offset,
      ).filter((index) => index !== finalIndex);
      const stages = groupTurnStages(displayMessages, stageIndices, String(targetTurn.startIndex));
      const targetStage = stages.find((stage) => stage.indices.includes(targetIndex));
      if (targetStage) setExpandedStages((current) => ({ ...current, [targetStage.key]: true }));
    }
    stickToBottomRef.current = false;
    setSearchHighlightIndex(targetIndex);
  }, [logicalTurns, displayMessages, searchTarget, sessionId]);

  useEffect(() => {
    if (searchHighlightIndex === undefined) return;
    const alignTarget = () => {
      const list = listRef.current;
      const target = document.getElementById(`chat-msg-${searchHighlightIndex}`);
      if (!list || !target) return;
      list.scrollTop = Math.max(
        0,
        target.offsetTop - (list.clientHeight - target.offsetHeight) / 2,
      );
      target.focus({ preventScroll: true });
    };
    alignTarget();
    // Session replacement can apply a late layout/state refresh after the
    // target first renders. Keep the selected hit aligned during its short
    // highlight window, then release normal scrolling.
    const alignTimer = window.setInterval(() => {
      const list = listRef.current;
      const target = document.getElementById(`chat-msg-${searchHighlightIndex}`);
      if (!list || !target) return;
      const listRect = list.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.bottom <= listRect.top || targetRect.top >= listRect.bottom) alignTarget();
    }, 100);
    const handledTimer = window.setTimeout(() => onSearchTargetHandled?.(), 2_000);
    return () => {
      window.clearInterval(alignTimer);
      window.clearTimeout(handledTimer);
    };
  }, [onSearchTargetHandled, searchHighlightIndex]);

  useEffect(() => {
    if (searchHighlightIndex === undefined) return;
    const timer = window.setTimeout(() => setSearchHighlightIndex(undefined), 2400);
    return () => window.clearTimeout(timer);
  }, [searchHighlightIndex]);

  // 独立会话窗口的 attach：cwd 优先取建窗 query（main 侧已随 ?cwd= 下发），
  // 缺省再回退全量 listAll 推导；都找不到时 cwd 缺省，由 main 侧 switch 报错
  const attachDetached = useCallback(async (sessionPath: string) => {
    timingMark('attach:start');
    let cwd = new URLSearchParams(window.location.search).get('cwd') ?? undefined;
    if (!cwd) {
      const row = await hostApi.piSessions.listAll()
        .then((r) => r.sessions.find((session) => session.path === sessionPath))
        .catch(() => undefined);
      cwd = row?.cwd;
      timingMark('attach:listAll-done');
    }
    await switchSession(sessionPath, cwd);
    timingMark('attach:switch-done');
  }, [switchSession]);

  // 恢复上次的工作目录并启动会话；独立会话窗口跳过恢复，直接 attach 指定会话。
  // 仅窗口首个面板（primary）执行；其余面板由分栏树 splitAt/replacePane 驱动绑定。
  useEffect(() => {
    if (!primary) return;
    if (attachSession) {
      void attachDetached(attachSession);
      return;
    }
    void hostApi.settings.get('workspaceCwd').then((saved) => {
      if (saved) {
        setCwd(saved);
        void start(saved);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateScrollAffordance = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    const hasOverflow = list.scrollHeight > list.clientHeight + 2;
    const atBottom = !hasOverflow || distanceFromBottom <= 24;
    // 会话切换复位窗口内不更新 stick，避免顶部瞬态滚动把自动钉底关掉
    if (!scrollResetRef.current) stickToBottomRef.current = atBottom;
    setShowScrollToBottom(hasOverflow && !atBottom);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => updateScrollAffordance();
    updateScrollAffordance();
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [sessionId, started, updateScrollAffordance]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (stickToBottomRef.current) {
      list.scrollTo({ top: list.scrollHeight });
    }
    updateScrollAffordance();
  }, [displayMessages, updateScrollAffordance]);

  const scrollToBottom = () => {
    const list = listRef.current;
    if (!list) return;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  };

  const chooseWorkspace = async () => {
    const result = await hostApi.dialog.openDirectory(t('chat.workspace.choose'));
    if (result.canceled || !result.filePaths[0]) return;
    const dir = result.filePaths[0];
    // 工作区安全：主目录/盘符根被 main 侧拒绝，这里中止并提示（不再启动）
    const saved = await hostApi.settings.set('workspaceCwd', dir);
    if (!saved.success) {
      setWorkspaceError(workspaceErrorMessage(saved.error, t));
      return;
    }
    setWorkspaceError(undefined);
    setCwd(dir);
    void start(dir);
  };

  const formatTurnDuration = (durationMs: number | null): string | null => {
    if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const duration = hours > 0
      ? t('chat.turnFold.durationHours', { hours, minutes, seconds })
      : minutes > 0
        ? t('chat.turnFold.durationMinutes', { minutes, seconds })
        : t('chat.turnFold.durationSeconds', { seconds });
    return t('chat.turnFold.duration', { duration });
  };

  const renderTurn = (turn: (typeof logicalTurns)[number], turnIndex: number) => {
    const finalIndex = turnFinalResponseIndex(displayMessages, turn);
    const completed = !turn.toolCallIds.some((id) => toolExecutions[id]?.status === 'running')
      && (turnIndex < logicalTurns.length - 1 || !isStreaming);
    // 压缩摘要是会话历史的重要内容，不能随着它恰好落入某一轮而被折叠隐藏。
    const hasCompactionSummary = displayMessages
      .slice(turn.startIndex, turn.endIndex + 1)
      .some((message) => message.role === 'compactionSummary');
    const canFold = completed && !hasCompactionSummary;
    const expanded = expandedTurns[turn.startIndex] ?? false;
    const hasEdits = completed && turn.toolCallIds.some((id) => {
      const name = toolExecutions[id]?.toolName;
      return name === 'edit' || name === 'write';
    });

    if (!canFold) {
      return (
        <Fragment key={turn.startIndex}>
          {Array.from({ length: turn.endIndex - turn.startIndex + 1 }, (_, offset) => turn.startIndex + offset).map((i) => (
            <MessageItem
              key={i}
              message={displayMessages[i]}
              anchorId={`chat-msg-${i}`}
              highlighted={searchHighlightIndex === i}
              cacheMiss={cacheMisses.get(i)}
              turnStats={i === latestFinalResponseIndex ? turnStats : null}
              sessionCacheHitRate={i === latestFinalResponseIndex ? sessionCacheHitRate : null}
            />
          ))}
          {hasEdits && <TurnChangesCard toolCallIds={turn.toolCallIds} />}
        </Fragment>
      );
    }

    if (finalIndex === undefined) {
      const processIndices = Array.from(
        { length: turn.endIndex - turn.startIndex },
        (_, offset) => turn.startIndex + 1 + offset,
      );
      const stages = groupTurnStages(displayMessages, processIndices, String(turn.startIndex));
      const hasProcess = stages.length > 0;
      const duration = formatTurnDuration(turnDurationMs(
        displayMessages,
        turn,
        toolExecutions,
      ));

      return (
        <Fragment key={turn.startIndex}>
          <MessageItem
            message={displayMessages[turn.startIndex]}
            anchorId={`chat-msg-${turn.startIndex}`}
            highlighted={searchHighlightIndex === turn.startIndex}
          />
          {hasProcess && (
            <section className={`turn-fold${expanded ? ' expanded' : ''}`} data-testid="turn-fold">
              <button
                className="turn-fold-toggle"
                data-testid="turn-fold-toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedTurns((current) => ({
                  ...current,
                  [turn.startIndex]: !expanded,
                }))}
              >
                <span className="turn-fold-label">
                  <span className="turn-fold-status" data-testid="turn-fold-status">{t('chat.turnFold.interrupted')}</span>
                  {duration && <span className="turn-fold-duration" data-testid="turn-fold-duration">{duration}</span>}
                  <span className="turn-fold-action">
                    {expanded ? t('chat.turnFold.collapse') : t('chat.turnFold.expand')}
                  </span>
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
              {expanded && (
                <div className="turn-fold-content" data-testid="turn-fold-content">
                  {stages.map((stage, stageIndex) => {
                    const stageExpanded = expandedStages[stage.key] ?? false;
                    return (
                      <section className={`process-stage${stageExpanded ? ' expanded' : ''}`} data-testid="process-stage" key={stage.key}>
                        <button
                          className="process-stage-toggle"
                          data-testid="process-stage-toggle"
                          aria-expanded={stageExpanded}
                          onClick={() => setExpandedStages((current) => ({ ...current, [stage.key]: !stageExpanded }))}
                        >
                          <ChevronRight size={13} aria-hidden="true" />
                          <span>{t('chat.turnFold.stage', { index: stageIndex + 1, count: stage.indices.length })}</span>
                        </button>
                        {stageExpanded && (
                          <div className="process-stage-content">
                            {stage.indices.map((i) => (
                              <MessageItem
                                key={i}
                                message={displayMessages[i]}
                                anchorId={`chat-msg-${i}`}
                                highlighted={searchHighlightIndex === i}
                                cacheMiss={cacheMisses.get(i)}
                                expandThinking
                                expandTools
                                groupedThinking
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          {hasEdits && <TurnChangesCard toolCallIds={turn.toolCallIds} />}
        </Fragment>
      );
    }

    const finalMessage = displayMessages[finalIndex];
    const finalText = finalMessage.content.filter((block) => block.type === 'text');
    const finalProcess = finalMessage.content.filter((block) => block.type !== 'text');
    const processIndices = Array.from(
      { length: turn.endIndex - turn.startIndex },
      (_, offset) => turn.startIndex + 1 + offset,
    ).filter((i) => i !== finalIndex);
    const stageIndices = [...processIndices, ...(finalProcess.length > 0 ? [finalIndex] : [])];
    const stages = groupTurnStages(displayMessages, stageIndices, String(turn.startIndex));
    const hasProcess = stages.length > 0;
    const duration = formatTurnDuration(turnDurationMs(
      displayMessages,
      turn,
      toolExecutions,
      finalIndex === latestFinalResponseIndex ? turnStats?.durationMs : undefined,
    ));

    return (
      <Fragment key={turn.startIndex}>
        <MessageItem
          message={displayMessages[turn.startIndex]}
          anchorId={`chat-msg-${turn.startIndex}`}
          highlighted={searchHighlightIndex === turn.startIndex}
        />
        {hasProcess && (
          <section className={`turn-fold${expanded ? ' expanded' : ''}`} data-testid="turn-fold">
            <button
              className="turn-fold-toggle"
              data-testid="turn-fold-toggle"
              aria-expanded={expanded}
              onClick={() => setExpandedTurns((current) => ({
                ...current,
                [turn.startIndex]: !expanded,
              }))}
            >
              <span className="turn-fold-label">
                {duration && <span className="turn-fold-duration" data-testid="turn-fold-duration">{duration}</span>}
                <span className="turn-fold-action">
                  {expanded ? t('chat.turnFold.collapse') : t('chat.turnFold.expand')}
                </span>
              </span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            {expanded && (
              <div className="turn-fold-content" data-testid="turn-fold-content">
                {stages.map((stage, stageIndex) => {
                  const stageExpanded = expandedStages[stage.key] ?? false;
                  return (
                    <section className={`process-stage${stageExpanded ? ' expanded' : ''}`} data-testid="process-stage" key={stage.key}>
                      <button
                        className="process-stage-toggle"
                        data-testid="process-stage-toggle"
                        aria-expanded={stageExpanded}
                        onClick={() => setExpandedStages((current) => ({ ...current, [stage.key]: !stageExpanded }))}
                      >
                        <ChevronRight size={13} aria-hidden="true" />
                        <span>{t('chat.turnFold.stage', { index: stageIndex + 1, count: stage.indices.length })}</span>
                      </button>
                      {stageExpanded && (
                        <div className="process-stage-content">
                          {stage.indices.map((i) => (
                            <MessageItem
                              key={i}
                              message={displayMessages[i]}
                              anchorId={i === finalIndex ? undefined : `chat-msg-${i}`}
                              highlighted={searchHighlightIndex === i}
                              contentOverride={i === finalIndex ? finalProcess : undefined}
                              cacheMiss={cacheMisses.get(i)}
                              expandThinking
                              expandTools
                              groupedThinking
                              suppressTail={i === finalIndex}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        )}
        <MessageItem
          message={finalMessage}
          anchorId={`chat-msg-${finalIndex}`}
          highlighted={searchHighlightIndex === finalIndex}
          contentOverride={finalText}
          cacheMiss={cacheMisses.get(finalIndex)}
          turnStats={finalIndex === latestFinalResponseIndex ? turnStats : null}
          sessionCacheHitRate={finalIndex === latestFinalResponseIndex ? sessionCacheHitRate : null}
        />
        {hasEdits && <TurnChangesCard toolCallIds={turn.toolCallIds} />}
      </Fragment>
    );
  };

  if (!effectiveCwd) {
    // attach 进行中/失败（独立窗口 ?session= 或分栏拖入）：不做 workspaceCwd 恢复，
    // 也不展示工作区选择；失败时按各自目标重试
    const attachRetry = attachSession
      ? () => void attachDetached(attachSession)
      : attachTarget
        ? () => void chatStore.getState().switchSession(attachTarget.sessionPath, attachTarget.cwd)
        : null;
    if (attachRetry || !primary) {
      return (
        <div className="chat-page chat-empty">
          {onClosePane && (
            <button className="icon-button pane-close-floating" data-testid="pane-close" title={t('chat.closePane')} aria-label={t('chat.closePane')} onClick={onClosePane}>
              <X size={16} />
            </button>
          )}
          <p data-testid="chat-attaching">{startError === 'start-timeout' ? t('chat.startTimeout') : workspaceErrorMessage(startError, t) ?? t('chat.starting')}</p>
          {startError && attachRetry && (
            <button className="primary" data-testid="attach-retry" onClick={attachRetry}>
              {t('chat.startRetry')}
            </button>
          )}
          <ExtensionUiDialog />
        </div>
      );
    }
    return (
      <div className="chat-page chat-empty">
        <p>{t('chat.workspace.required')}</p>
        <button className="primary" data-testid="choose-workspace" onClick={() => void chooseWorkspace()}>
          {t('chat.workspace.choose')}
        </button>
        {workspaceError && (
          <p className="error-text" data-testid="workspace-error">{workspaceError}</p>
        )}
        <ExtensionUiDialog />
      </div>
    );
  }

  // banner 重试语义：上次失败的是会话切换时重发切换（start 会因 started 守卫早退且语义不符），
  // 否则按原语义在工作区重启会话
  const retryStart = lastFailedSwitch
    ? () => void switchSession(lastFailedSwitch.path, lastFailedSwitch.cwd)
    : () => void start(effectiveCwd);

  // 模型不可用（MODEL_UNAVAILABLE）：provider/model 从错误文本解析供文案插值；
  // 解析不出（如网关 503 文案不含 provider/id）时退回原始错误展示
  const unavailableModel = startErrorCode === 'MODEL_UNAVAILABLE' && startError
    ? parseProviderError(startError)
    : undefined;
  const unavailableProvider = unavailableModel?.providerId;
  const unavailableModelId = unavailableModel?.modelId;
  const modelUnavailable = unavailableProvider !== undefined && unavailableModelId !== undefined;

  return (
    <div className={`chat-page${workspaceVisible ? ' workspace-visible' : ''}`}>
      <div className="chat-column">
        {startError && (
          <div className="error-banner">
            <div className="error-banner-text">
              <span>
                {modelUnavailable
                  ? t('chat.error.modelUnavailable', { provider: unavailableProvider, model: unavailableModelId })
                  : startError === 'start-timeout'
                    ? t('chat.startTimeout')
                    : (() => {
                      // 通道级超时（如切换请求 30s 无响应）翻译成可读文案；
                      // 其余 main 侧错误保留原文（有诊断价值，且来源多样无法穷举）
                      const timeoutAction = matchHostInvokeTimeout(startError);
                      return timeoutAction
                        ? t('chat.errors.hostInvokeTimeout', { action: timeoutAction })
                        : workspaceErrorMessage(startError, t);
                    })()}
              </span>
              {lastFailedSwitch && started && (
                <span className="error-banner-note" data-testid="switch-failed-note">
                  {t('chat.switchFailedNote')}
                </span>
              )}
            </div>
            {effectiveCwd && (
              <>
                {modelUnavailable && (
                  <button
                    data-testid="model-unavailable-choose"
                    onClick={() => setModelMenuNonce((nonce) => nonce + 1)}
                  >
                    {t('chat.error.chooseModel')}
                  </button>
                )}
                <button data-testid="start-retry" onClick={retryStart}>
                  {modelUnavailable ? t('chat.error.retrySwitch') : t('chat.startRetry')}
                </button>
              </>
            )}
            <button
              className="error-banner-dismiss"
              data-testid="start-error-dismiss"
              onClick={dismissStartError}
              aria-label={t('chat.runtimeErrorDismiss')}
              title={t('chat.runtimeErrorDismiss')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {onClosePane && !started && (
          <button className="icon-button pane-close-floating" data-testid="pane-close" title={t('chat.closePane')} aria-label={t('chat.closePane')} onClick={onClosePane}>
            <X size={16} />
          </button>
        )}
        {started && <SessionTitleBar onClosePane={onClosePane} />}
        <div className="chat-message-region">
          <div className="message-list" ref={listRef} data-testid="message-list">
            {!started && starting && (
              <div className="chat-starting" data-testid="chat-starting">{t('chat.starting')}</div>
            )}
            {started && displayMessages.length === 0 && (
              <ChatGreeting cwd={effectiveCwd} />
            )}
            {displayMessages.slice(0, logicalTurns[0]?.startIndex ?? displayMessages.length).map((message, i) => (
              <MessageItem
                key={i}
                message={message}
                anchorId={`chat-msg-${i}`}
                highlighted={searchHighlightIndex === i}
                cacheMiss={cacheMisses.get(i)}
              />
            ))}
            {logicalTurns.map(renderTurn)}
            {/* 回合外的独立消息（bash 执行等，groupLogicalTurns 跳过不并入回合） */}
            {displayMessages.slice((logicalTurns[logicalTurns.length - 1]?.endIndex ?? -1) + 1).map((message, i) => {
              const index = (logicalTurns[logicalTurns.length - 1]?.endIndex ?? -1) + 1 + i;
              return (
                <MessageItem
                  key={index}
                  message={message}
                  anchorId={`chat-msg-${index}`}
                  highlighted={searchHighlightIndex === index}
                  cacheMiss={cacheMisses.get(index)}
                />
              );
            })}
            {bashDraft && (
              <MessageItem
                message={{
                  role: 'bashExecution',
                  content: [],
                  streaming: true,
                  raw: {
                    command: bashDraft.command,
                    output: bashDraft.output,
                    excludeFromContext: bashDraft.excludeFromContext,
                  },
                }}
              />
            )}
          </div>
          {!transcriptSyncing && (
            <MessageNavRail anchors={railAnchors} compactionAnchors={compactionAnchors} listRef={listRef} />
          )}
          {showScrollToBottom && (
            <button
              className="scroll-to-bottom"
              data-testid="scroll-to-bottom"
              type="button"
              title={t('chat.scrollToBottom')}
              aria-label={t('chat.scrollToBottom')}
              onClick={scrollToBottom}
            >
              <ArrowDown size={20} aria-hidden="true" />
            </button>
          )}
        </div>

        {runtimeError && (() => {
          // store 保持 node-safe 不能引 i18n：替换超时以哨兵值入 state，这里翻译。
          // 通道超时同理按 message 形态识别；供应商类错误附归属 hint（与消息流内一致）。
          const timeoutAction = matchHostInvokeTimeout(runtimeError);
          const parsed = parseProviderError(runtimeError);
          return (
            <div className="runtime-error-notice" data-testid="runtime-error-notice" role="alert">
              <span className="runtime-error-text">
                <span className="runtime-error-title">{t('chat.runtimeErrorTitle')}</span>
                {runtimeError === SESSION_REPLACEMENT_TIMEOUT
                  ? t('chat.errors.replacementTimeout')
                  : timeoutAction
                    ? t('chat.errors.hostInvokeTimeout', { action: timeoutAction })
                    : runtimeError}
                {/* 哨兵/通道超时已有专属文案（且非供应商错误），不再叠供应商归属提示 */}
                {parsed.category !== 'unknown' && !timeoutAction && runtimeError !== SESSION_REPLACEMENT_TIMEOUT && (
                  <div className="error-hint" data-testid={`runtime-error-hint-${parsed.category}`}>
                    {t(`chat.errors.${PROVIDER_ERROR_HINT_KEYS[parsed.category]}`)}
                  </div>
                )}
              </span>
              <button type="button" data-testid="runtime-error-dismiss" onClick={dismissRuntimeError}>
                {t('chat.runtimeErrorDismiss')}
              </button>
            </div>
          );
        })()}

        <ExtensionWidgets placement="aboveEditor" />
        <StatusBar />
        <ChatInput
          cwd={effectiveCwd}
          onChooseWorkspace={chooseWorkspace}
          openModelMenuNonce={modelMenuNonce}
        />
        <ExtensionWidgets placement="belowEditor" />
      </div>
      <TreeDialog />
      <ReviewPanel />
      <ExtensionUiDialog />
    </div>
  );
}

/**
 * 窗口级 Chat 页：渲染分栏布局树（PaneLayout）。初始 root = 单叶子
 * default 面板（绑定 defaultChatStore 实例，承载 ?session= attach / workspaceCwd
 * 恢复语义）；拖入分栏后由 panes store 驱动渲染 N 个 ChatStoreProvider + ChatPane。
 */
export default function ChatPage(props: Props) {
  return (
    <PaneLayout
      searchTarget={props.searchTarget}
      onSearchTargetHandled={props.onSearchTargetHandled}
    />
  );
}
