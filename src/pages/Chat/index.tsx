import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '../../lib/host-api';
import { useChatStore } from '../../stores/chat';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';

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
        <div className="message-list" ref={listRef} data-testid="message-list">
          {started && messages.length === 0 && (
            <div className="chat-greeting" data-testid="chat-greeting">
              <h1>{t('chat.greeting')}</h1>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageItem key={i} message={m} />
          ))}
        </div>

        <ChatInput
          cwd={effectiveCwd}
          onChooseWorkspace={chooseWorkspace}
          onNewSession={() => void newSession()}
        />
      </div>
    </div>
  );
}
