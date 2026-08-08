import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectCacheMisses } from '../../lib/cache-stats';
import { hostApi } from '../../lib/host-api';
import { useChatStore } from '../../stores/chat';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';
import { MessageNavRail, type RailAnchor } from './MessageNavRail';
import { StatusBar } from './StatusBar';
import { ReviewPanel } from './ReviewPanel';
import { TreeDialog } from './TreeDialog';

/** 消息列表工具栏：全局展开/折叠所有工具卡片 + 分支树（/tree）+ Review 面板入口 */
function ChatToolbar() {
  const { t } = useTranslation();
  const toolsExpanded = useChatStore((s) => s.toolsExpanded);
  const toggleToolsExpanded = useChatStore((s) => s.toggleToolsExpanded);
  const setTreeOpen = useChatStore((s) => s.setTreeOpen);
  const setReviewOpen = useChatStore((s) => s.setReviewOpen);
  return (
    <div className="chat-toolbar">
      <button className="chat-toolbar-btn" data-testid="open-review" onClick={() => setReviewOpen(true)}>
        {t('review.title')}
      </button>
      <button className="chat-toolbar-btn" data-testid="open-tree" onClick={() => setTreeOpen(true)}>
        {t('chat.branches')}
      </button>
      <button className="chat-toolbar-btn" data-testid="toggle-tools" onClick={toggleToolsExpanded}>
        {toolsExpanded ? t('chat.collapseTools') : t('chat.expandTools')}
      </button>
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
  const start = useChatStore((s) => s.start);
  const newSession = useChatStore((s) => s.newSession);
  // 跨项目切换会话时以 runtime 的实际 cwd 为准
  const activeCwd = useChatStore((s) => (s.started ? s.cwd : undefined));
  const effectiveCwd = activeCwd ?? cwd;
  const listRef = useRef<HTMLDivElement>(null);

  // user 消息稳定锚点（消息列表在会话内只追加，index 锚点稳定）
  const railAnchors = useMemo<RailAnchor[]>(() => {
    let n = 0;
    return messages.flatMap((m, i) =>
      m.role === 'user' ? [{ id: `chat-msg-${i}`, n: (n += 1) }] : [],
    );
  }, [messages]);

  // 缓存失效检测（pi cache-stats 口径）：按下标分发给 assistant 消息尾部警告
  const cacheMisses = useMemo(() => collectCacheMisses(messages), [messages]);

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
        {started && messages.length > 0 && <ChatToolbar />}
        <div className="message-list" ref={listRef} data-testid="message-list">
          {started && messages.length === 0 && (
            <div className="chat-greeting" data-testid="chat-greeting">
              <h1>{t('chat.greeting')}</h1>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageItem
              key={i}
              message={m}
              anchorId={m.role === 'user' ? `chat-msg-${i}` : undefined}
              cacheMiss={cacheMisses.get(i)}
            />
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
