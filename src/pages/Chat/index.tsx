import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiModelRow } from '@shared/host-api/contract';
import { hostApi } from '../../lib/host-api';
import { useChatStore } from '../../stores/chat';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';

function ModelSelector() {
  const model = useChatStore((s) => s.model);
  const [models, setModels] = useState<PiModelRow[]>([]);

  useEffect(() => {
    void hostApi.providers.listModels().then((r) => setModels(r.models)).catch(() => {});
  }, []);

  if (models.length === 0) {
    return model ? <span className="model-badge" data-testid="model-badge">{model.name ?? model.id}</span> : null;
  }
  return (
    <select
      className="model-select"
      data-testid="model-select"
      value={model ? `${model.provider}/${model.id}` : ''}
      onChange={(e) => {
        const [provider, ...rest] = e.target.value.split('/');
        void hostApi.piRuntime.setModel(provider, rest.join('/'));
      }}
    >
      {models.map((m) => (
        <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
          {m.name ?? m.id}
        </option>
      ))}
    </select>
  );
}

export default function ChatPage() {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState<string | undefined>();
  const started = useChatStore((s) => s.started);
  const starting = useChatStore((s) => s.starting);
  const startError = useChatStore((s) => s.startError);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const compacting = useChatStore((s) => s.compacting);
  const start = useChatStore((s) => s.start);
  const newSession = useChatStore((s) => s.newSession);
  const compact = useChatStore((s) => s.compact);
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

  if (!cwd) {
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
      <header className="chat-header">
        <span className="workspace" title={cwd}>{cwd}</span>
        <button onClick={() => void chooseWorkspace()}>{t('chat.workspace.change')}</button>
        <span className="spacer" />
        <ModelSelector />
        <button onClick={() => void compact()} disabled={isStreaming || compacting}>
          {compacting ? t('chat.compacting') : t('chat.compact')}
        </button>
        <button data-testid="new-session" onClick={() => void newSession()} disabled={isStreaming}>
          {t('chat.newSession')}
        </button>
      </header>

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

        <ChatInput />
      </div>
    </div>
  );
}
