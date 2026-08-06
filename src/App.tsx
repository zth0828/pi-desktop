import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bindPiSystemEvents, usePiSystemStore } from './stores/pi-system';
import { bindChatEvents, useChatStore } from './stores/chat';
import { hostApi } from './lib/host-api';
import { SessionList } from './components/SessionList';
import Onboarding from './pages/Onboarding';
import ChatPage from './pages/Chat';
import ModelsPage from './pages/Models';
import SessionsPage from './pages/Sessions';
import SettingsPage from './pages/Settings';
import SkillsPage from './pages/Skills';
import i18n from './lib/i18n';

type PageId = 'chat' | 'models' | 'sessions' | 'skills' | 'extensions' | 'mcp' | 'settings';
const PAGES: PageId[] = ['chat', 'models', 'sessions', 'skills', 'extensions', 'mcp', 'settings'];

// M5 逐步填充的页面占位（Skills/Extensions/MCP/Settings）
function PlaceholderPage({ id }: { id: PageId }) {
  const { t } = useTranslation();
  return (
    <div className="placeholder-page">
      <h2>{t(`nav.${id}`)}</h2>
      <p className="hint">{t('nav.placeholder')}</p>
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageId>('chat');
  const state = usePiSystemStore((s) => s.state);
  const env = usePiSystemStore((s) => s.env);
  const latestVersion = usePiSystemStore((s) => s.latestVersion);
  const detect = usePiSystemStore((s) => s.detect);
  const chatStarted = useChatStore((s) => s.started);
  const isStreaming = useChatStore((s) => s.isStreaming);

  useEffect(() => {
    const unbind = bindPiSystemEvents();
    bindChatEvents();
    void detect();
    // 恢复保存的语言
    void hostApi.settings.get('language').then((lng) => {
      if (lng && lng !== i18n.language) void i18n.changeLanguage(lng);
    });
    return unbind;
  }, [detect]);

  if (state !== 'ready') {
    return <Onboarding />;
  }

  const newChat = () => {
    setPage('chat');
    if (chatStarted && !isStreaming) void hostApi.piRuntime.newSession();
  };

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-title drag-region">Pi Desktop</div>
        <button className="primary new-chat" data-testid="new-chat" onClick={newChat}>
          {t('sidebar.newChat')}
        </button>
        <SessionList />
        <div className="sidebar-nav">
          {PAGES.map((id) => (
            <button
              key={id}
              data-testid={`nav-${id}`}
              className={page === id ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(id)}
            >
              {t(`nav.${id}`)}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <span className="hint">{t('status.ready', { version: env?.pi.version })}</span>
          {latestVersion && latestVersion !== env?.pi.version && (
            <span className="hint">{t('status.latestAvailable', { version: latestVersion })}</span>
          )}
        </div>
      </nav>
      <main className="content">
        {page === 'chat' ? (
          <ChatPage />
        ) : page === 'models' ? (
          <ModelsPage />
        ) : page === 'sessions' ? (
          <SessionsPage />
        ) : page === 'skills' ? (
          <SkillsPage />
        ) : page === 'settings' ? (
          <SettingsPage />
        ) : (
          <PlaceholderPage id={page} />
        )}
      </main>
    </div>
  );
}
