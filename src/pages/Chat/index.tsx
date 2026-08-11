import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Check, ChevronRight, PanelRight, Pencil, X } from 'lucide-react';
import { collectCacheMisses } from '../../lib/cache-stats';
import { hostApi } from '../../lib/host-api';
import { sessionTitleFromQuestion } from '../../lib/session-title';
import { groupLogicalTurns, groupTurnStages, turnDurationMs, turnFinalResponseIndex } from '../../lib/turn-changes';
import { useChatStore } from '../../stores/chat';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';
import { MessageNavRail, type RailAnchor } from './MessageNavRail';
import { StatusBar } from './StatusBar';
import { ReviewPanel } from './ReviewPanel';
import { TreeDialog } from './TreeDialog';
import { TurnChangesCard } from './TurnChangesCard';

function SessionTitleBar() {
  const { t } = useTranslation();
  const setReviewOpen = useChatStore((s) => s.setReviewOpen);
  const workspaceOpen = useChatStore((s) => s.workspaceOpen);
  const reviewOpen = useChatStore((s) => s.reviewOpen);
  const setWorkspaceOpen = useChatStore((s) => s.setWorkspaceOpen);
  const started = useChatStore((s) => s.started);
  const sessionId = useChatStore((s) => s.sessionId);
  const firstUserMessage = useChatStore((s) => s.messages.find((entry) => entry.role === 'user'));
  const firstUserQuestion = firstUserMessage?.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ') ?? '';
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (!started) return;
    const refresh = () => {
      void hostApi.piRuntime.getSessionInfo().then((info) => setName(info?.name ?? ''));
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [started, sessionId]);
  const displayName = name || (firstUserMessage
    ? sessionTitleFromQuestion(firstUserQuestion, t('chat.imageSessionTitle'))
    : t('chat.untitled'));
  const beginRename = () => { setDraft(name || (firstUserMessage ? displayName : '')); setEditing(true); };
  const saveRename = async () => {
    const next = draft.trim();
    if (!next) { setEditing(false); return; }
    const result = await hostApi.piRuntime.setSessionName(next);
    if (result.success) setName(result.name ?? next);
    setEditing(false);
  };
  return (
    <div className="session-titlebar" data-testid="session-titlebar">
      <div className="session-title">
        {editing ? (
          <>
            <input autoFocus value={draft} aria-label={t('chat.renameSession')} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setEditing(false); }} />
            <button className="icon-button" title={t('chat.saveRename')} onClick={() => void saveRename()}><Check size={15} /></button>
            <button className="icon-button" title={t('chat.cancelRename')} onClick={() => setEditing(false)}><X size={15} /></button>
          </>
        ) : (
          <button className="session-title-button" data-testid="session-title-button" onClick={beginRename} title={t('chat.renameSession')}>
            <span>{displayName}</span><Pencil size={13} />
          </button>
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
      </div>
    </div>
  );
}

function ExtensionWidgets({ placement }: { placement: 'aboveEditor' | 'belowEditor' }) {
  const extensionUi = useChatStore((s) => s.extensionUi);
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

export default function ChatPage() {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState<string | undefined>();
  const started = useChatStore((s) => s.started);
  const starting = useChatStore((s) => s.starting);
  const startError = useChatStore((s) => s.startError);
  const messages = useChatStore((s) => s.messages);
  const toolExecutions = useChatStore((s) => s.toolExecutions);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const turnStats = useChatStore((s) => s.turnStats);
  const sessionId = useChatStore((s) => s.sessionId);
  const workspaceVisible = useChatStore((s) => s.workspaceOpen || s.reviewOpen);
  const start = useChatStore((s) => s.start);
  // 跨项目切换会话时以 runtime 的实际 cwd 为准
  const activeCwd = useChatStore((s) => (s.started ? s.cwd : undefined));
  const effectiveCwd = activeCwd ?? cwd;
  const listRef = useRef<HTMLDivElement>(null);
  // 一个 user 问题对应一个完整回合；完成后默认收起 thinking/阶段文本/工具调用。
  const [expandedTurns, setExpandedTurns] = useState<Record<number, boolean>>({});
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    setExpandedTurns({});
    setExpandedStages({});
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
  }, [sessionId]);

  // user 消息稳定锚点（消息列表在会话内只追加，index 锚点稳定）
  const railAnchors = useMemo<RailAnchor[]>(() => {
    let n = 0;
    return messages.flatMap((m, i) =>
      m.role === 'user' ? [{
        id: `chat-msg-${i}`,
        n: (n += 1),
        question: m.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      }] : [],
    );
  }, [messages]);

  // 缓存失效检测（pi cache-stats 口径）：按下标分发给 assistant 消息尾部警告
  const cacheMisses = useMemo(() => collectCacheMisses(messages), [messages]);

  const latestFinalResponseIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.content.some((block) => block.type === 'text' && block.text?.trim())) return i;
    }
    return -1;
  }, [messages]);

  const logicalTurns = useMemo(() => groupLogicalTurns(messages), [messages]);

  // 恢复上次的工作目录并启动会话
  useEffect(() => {
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
    stickToBottomRef.current = atBottom;
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
  }, [messages, updateScrollAffordance]);

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
    await hostApi.settings.set('workspaceCwd', dir);
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
    const finalIndex = turnFinalResponseIndex(messages, turn);
    const completed = !turn.toolCallIds.some((id) => toolExecutions[id]?.status === 'running')
      && (turnIndex < logicalTurns.length - 1 || !isStreaming);
    // 异常/中断轮可能没有最终答复，这时全量展示，避免隐藏唯一的错误信息。
    const canFold = completed && finalIndex !== undefined;
    const expanded = expandedTurns[turn.startIndex] ?? false;
    const hasEdits = completed && turn.toolCallIds.some((id) => {
      const name = toolExecutions[id]?.toolName;
      return name === 'edit' || name === 'write';
    });

    if (!canFold || finalIndex === undefined) {
      return (
        <Fragment key={turn.startIndex}>
          {Array.from({ length: turn.endIndex - turn.startIndex + 1 }, (_, offset) => turn.startIndex + offset).map((i) => (
            <MessageItem
              key={i}
              message={messages[i]}
              anchorId={i === turn.startIndex ? `chat-msg-${i}` : undefined}
              cacheMiss={cacheMisses.get(i)}
              turnStats={i === latestFinalResponseIndex ? turnStats : null}
              expandThinking
            />
          ))}
          {hasEdits && <TurnChangesCard toolCallIds={turn.toolCallIds} />}
        </Fragment>
      );
    }

    const finalMessage = messages[finalIndex];
    const finalText = finalMessage.content.filter((block) => block.type === 'text');
    const finalProcess = finalMessage.content.filter((block) => block.type !== 'text');
    const processIndices = Array.from(
      { length: turn.endIndex - turn.startIndex },
      (_, offset) => turn.startIndex + 1 + offset,
    ).filter((i) => i !== finalIndex);
    const stageIndices = [...processIndices, ...(finalProcess.length > 0 ? [finalIndex] : [])];
    const stages = groupTurnStages(messages, stageIndices, String(turn.startIndex));
    const hasProcess = stages.length > 0;
    const duration = formatTurnDuration(turnDurationMs(
      messages,
      turn,
      toolExecutions,
      finalIndex === latestFinalResponseIndex ? turnStats?.durationMs : undefined,
    ));

    return (
      <Fragment key={turn.startIndex}>
        <MessageItem message={messages[turn.startIndex]} anchorId={`chat-msg-${turn.startIndex}`} />
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
                              message={messages[i]}
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
          contentOverride={finalText}
          cacheMiss={cacheMisses.get(finalIndex)}
          turnStats={finalIndex === latestFinalResponseIndex ? turnStats : null}
        />
        {hasEdits && <TurnChangesCard toolCallIds={turn.toolCallIds} />}
      </Fragment>
    );
  };

  if (!effectiveCwd) {
    return (
      <div className="chat-page chat-empty">
        <p>{t('chat.workspace.required')}</p>
        <button className="primary" data-testid="choose-workspace" onClick={() => void chooseWorkspace()}>
          {t('chat.workspace.choose')}
        </button>
      </div>
    );
  }

  return (
    <div className={`chat-page${workspaceVisible ? ' workspace-visible' : ''}`}>
      {startError && (
        <div className="error-banner">
          <span>{startError === 'start-timeout' ? t('chat.startTimeout') : startError}</span>
          {effectiveCwd && (
            <button data-testid="start-retry" onClick={() => void start(effectiveCwd)}>
              {t('chat.startRetry')}
            </button>
          )}
        </div>
      )}

      <div className="chat-column">
        {started && <SessionTitleBar />}
        <div className="chat-message-region">
          <div className="message-list" ref={listRef} data-testid="message-list">
            {!started && starting && (
              <div className="chat-starting" data-testid="chat-starting">{t('chat.starting')}</div>
            )}
            {started && messages.length === 0 && (
              <div className="chat-greeting" data-testid="chat-greeting">
                <h1>{t('chat.greeting')}</h1>
              </div>
            )}
            {messages.slice(0, logicalTurns[0]?.startIndex ?? messages.length).map((message, i) => (
              <MessageItem key={i} message={message} cacheMiss={cacheMisses.get(i)} />
            ))}
            {logicalTurns.map(renderTurn)}
          </div>
          <MessageNavRail anchors={railAnchors} listRef={listRef} />
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

        <ExtensionWidgets placement="aboveEditor" />
        <StatusBar />
        <ChatInput
          cwd={effectiveCwd}
          onChooseWorkspace={chooseWorkspace}
        />
        <ExtensionWidgets placement="belowEditor" />
      </div>
      <TreeDialog />
      <ReviewPanel />
    </div>
  );
}
