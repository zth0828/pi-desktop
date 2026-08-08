import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, MoreHorizontal, Pencil, X } from 'lucide-react';
import { collectCacheMisses } from '../../lib/cache-stats';
import { hostApi } from '../../lib/host-api';
import { groupLogicalTurns, turnTimeRange } from '../../lib/turn-changes';
import { useChatStore } from '../../stores/chat';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';
import type { TurnFold } from './MessageItem';
import { MessageNavRail, type RailAnchor } from './MessageNavRail';
import { StatusBar } from './StatusBar';
import { ReviewPanel } from './ReviewPanel';
import { TreeDialog } from './TreeDialog';
import { TurnChangesCard } from './TurnChangesCard';

function SessionTitleBar() {
  const { t } = useTranslation();
  const toolsExpanded = useChatStore((s) => s.toolsExpanded);
  const toggleToolsExpanded = useChatStore((s) => s.toggleToolsExpanded);
  const setTreeOpen = useChatStore((s) => s.setTreeOpen);
  const setReviewOpen = useChatStore((s) => s.setReviewOpen);
  const started = useChatStore((s) => s.started);
  const sessionId = useChatStore((s) => s.sessionId);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!started) return;
    void hostApi.piRuntime.getSessionInfo().then((info) => setName(info?.name ?? t('chat.untitled')));
  }, [started, sessionId, t]);
  const beginRename = () => { setDraft(name === t('chat.untitled') ? '' : name); setEditing(true); };
  const saveRename = async () => {
    const next = draft.trim();
    if (!next) { setEditing(false); return; }
    const result = await hostApi.piRuntime.setSessionName(next);
    if (result.success) setName(result.name ?? next);
    setEditing(false);
  };
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);
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
          <button className="session-title-button" onClick={beginRename} title={t('chat.renameSession')}>
            <span>{name || t('chat.untitled')}</span><Pencil size={13} />
          </button>
        )}
      </div>
      <div className="session-menu" ref={menuRef}>
        <button className="icon-button" data-testid="session-menu" title={t('chat.sessionMenu')} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={18} /></button>
        {menuOpen && (
        <div className="session-menu-popover">
          <button data-testid="open-review" onClick={() => { setMenuOpen(false); setReviewOpen(true); }}>{t('review.title')}</button>
          <button data-testid="open-tree" onClick={() => { setMenuOpen(false); setTreeOpen(true); }}>{t('chat.branches')}</button>
          <button data-testid="toggle-tools" onClick={() => { setMenuOpen(false); toggleToolsExpanded(); }}>{toolsExpanded ? t('chat.collapseTools') : t('chat.expandTools')}</button>
        </div>
        )}
      </div>
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
  const start = useChatStore((s) => s.start);
  const newSession = useChatStore((s) => s.newSession);
  // 跨项目切换会话时以 runtime 的实际 cwd 为准
  const activeCwd = useChatStore((s) => (s.started ? s.cwd : undefined));
  const effectiveCwd = activeCwd ?? cwd;
  const listRef = useRef<HTMLDivElement>(null);
  // 工作日志折叠的手动覆盖（点开历史轮后保持展开）；默认历史轮折叠、最新完成轮展开
  const [foldOverrides, setFoldOverrides] = useState<Record<number, boolean>>({});

  // user 消息稳定锚点（消息列表在会话内只追加，index 锚点稳定）
  const railAnchors = useMemo<RailAnchor[]>(() => {
    let n = 0;
    return messages.flatMap((m, i) =>
      m.role === 'user' ? [{ id: `chat-msg-${i}`, n: (n += 1) }] : [],
    );
  }, [messages]);

  // 缓存失效检测（pi cache-stats 口径）：按下标分发给 assistant 消息尾部警告
  const cacheMisses = useMemo(() => collectCacheMisses(messages), [messages]);

  // 按逻辑轮（user 消息边界，pi 的 agent run 是模型往返粒度、不能直接当轮边界）：
  // 已完成的历史轮折叠工具卡为「已处理 Xs」行，完成的轮尾部挂聚合编辑卡。
  // 折叠只藏工具卡，user/assistant 文本消息位置不动（rail 锚点 chat-msg-<index> 不受影响）。
  const { fold, turnCards } = useMemo(() => {
    const logical = groupLogicalTurns(messages);
    const lastIndex = logical.length - 1;
    // 完成判定：后面已有新一轮，或不处于流式；且该轮没有仍在执行的工具（steer 插入
    // 当前轮时 user 消息先到，上一轮的工具可能还在跑，不能折）
    const completed = logical.map((turn, j) => {
      if (turn.toolCallIds.some((id) => toolExecutions[id]?.status === 'running')) return false;
      return j < lastIndex || !isStreaming;
    });
    // 最新完成且含工具的轮保持展开（Codex 观感：历史轮折叠、最新一轮展开）
    let latestExpanded = -1;
    for (let j = lastIndex; j >= 0; j -= 1) {
      if (completed[j] && logical[j].toolCallIds.length > 0) {
        latestExpanded = j;
        break;
      }
    }
    const hidden = new Set<string>();
    const rows = new Map<string, { turn: number; startedAt?: number; endedAt?: number }>();
    logical.forEach((turn, j) => {
      if (!completed[j] || turn.toolCallIds.length === 0) return;
      const collapsed = foldOverrides[j] ?? j !== latestExpanded;
      if (!collapsed) return;
      const { startedAt, endedAt } = turnTimeRange(toolExecutions, turn.toolCallIds);
      turn.toolCallIds.forEach((id, k) => {
        if (k === 0) rows.set(id, { turn: j, startedAt, endedAt });
        else hidden.add(id);
      });
    });
    const cards = new Map<number, string[][]>();
    logical.forEach((turn, j) => {
      if (!completed[j]) return;
      // 只给含 edit/write 的轮挂卡（卡片自身还会按成功执行过滤，空轮不渲染）
      const hasEdits = turn.toolCallIds.some((id) => {
        const name = toolExecutions[id]?.toolName;
        return name === 'edit' || name === 'write';
      });
      if (!hasEdits) return;
      const list = cards.get(turn.endIndex) ?? [];
      list.push(turn.toolCallIds);
      cards.set(turn.endIndex, list);
    });
    return {
      fold: {
        hidden,
        rows,
        onExpand: (turn: number) => setFoldOverrides((prev) => ({ ...prev, [turn]: false })),
      } satisfies TurnFold,
      turnCards: cards,
    };
  }, [messages, toolExecutions, isStreaming, foldOverrides]);

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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const chooseWorkspace = async () => {
    const result = await hostApi.dialog.openDirectory(t('chat.workspace.choose'));
    if (result.canceled || !result.filePaths[0]) return;
    const dir = result.filePaths[0];
    await hostApi.settings.set('workspaceCwd', dir);
    setCwd(dir);
    void start(dir);
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
    <div className="chat-page">
      {startError && <div className="error-banner">{startError}</div>}
      {starting && <div className="chat-empty">{t('chat.starting')}</div>}

      <div className="chat-column">
        {started && <SessionTitleBar />}
        <div className="message-list" ref={listRef} data-testid="message-list">
          {started && messages.length === 0 && (
            <div className="chat-greeting" data-testid="chat-greeting">
              <h1>{t('chat.greeting')}</h1>
            </div>
          )}
          {messages.map((m, i) => (
            <Fragment key={i}>
              <MessageItem
                message={m}
                anchorId={m.role === 'user' ? `chat-msg-${i}` : undefined}
                cacheMiss={cacheMisses.get(i)}
                fold={fold}
              />
              {turnCards.get(i)?.map((toolCallIds, k) => (
                <TurnChangesCard key={k} toolCallIds={toolCallIds} />
              ))}
            </Fragment>
          ))}
        </div>
        <MessageNavRail anchors={railAnchors} listRef={listRef} />

        <StatusBar />
        <ChatInput
          cwd={effectiveCwd}
          onChooseWorkspace={chooseWorkspace}
          onNewSession={() => void newSession()}
        />
      </div>
      <TreeDialog />
      <ReviewPanel />
    </div>
  );
}
