import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bindPiSystemEvents, usePiSystemStore } from './stores/pi-system';
import { bindChatEvents } from './stores/chat';
import Onboarding from './pages/Onboarding';
import ChatPage from './pages/Chat';

type PageId = 'chat' | 'models' | 'sessions' | 'skills' | 'extensions' | 'mcp' | 'settings';
const PAGES: PageId[] = ['chat', 'models', 'sessions', 'skills', 'extensions', 'mcp', 'settings'];

// M2 起逐步填充的页面占位（Models/Sessions/Skills/Extensions/MCP/Settings）
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

  useEffect(() => {
    const unbind = bindPiSystemEvents();
    bindChatEvents();
    void detect();
    return unbind;
  }, [detect]);

  if (state !== 'ready') {
    return <Onboarding />;
  }

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-title">Pi Desktop</div>
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
        <div className="sidebar-footer">
          <span className="hint">{t('status.ready', { version: env?.pi.version })}</span>
          {latestVersion && latestVersion !== env?.pi.version && (
            <span className="hint">{t('status.latestAvailable', { version: latestVersion })}</span>
          )}
        </div>
      </nav>
      <main className="content">{page === 'chat' ? <ChatPage /> : <PlaceholderPage id={page} />}</main>
    </div>
  );
}
