import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  MessageSquare,
  Monitor,
  Plug,
  Plus,
  Puzzle,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { bindPiSystemEvents, usePiSystemStore } from './stores/pi-system';
import { bindChatEvents, useChatStore } from './stores/chat';
import { hostApi } from './lib/host-api';
import { onNavigateToPage } from './lib/app-navigation';
import { initTheme } from './lib/theme';
import { SessionList } from './components/SessionList';
import { ExtensionUiDialog, ExtensionUiNotifications } from './components/ExtensionUiDialog';
import Onboarding from './pages/Onboarding';
import ChatPage from './pages/Chat';
import ModelsPage from './pages/Models';
import SessionsPage from './pages/Sessions';
import SettingsPage from './pages/Settings';
import SkillsPage from './pages/Skills';
import ExtensionsPage from './pages/Extensions';
import McpPage from './pages/Mcp';
import i18n from './lib/i18n';
import { APP_PAGE_IDS, initialAppPage, type AppPageId } from '@shared/app-page';

const PAGE_ICONS: Record<AppPageId, typeof MessageSquare> = {
  chat: MessageSquare,
  models: Monitor,
  sessions: History,
  skills: Sparkles,
  extensions: Puzzle,
  mcp: Plug,
  settings: SettingsIcon,
};
const PAGES: Array<{ id: AppPageId; icon: typeof MessageSquare }> = APP_PAGE_IDS.map((id) => ({
  id,
  icon: PAGE_ICONS[id],
}));

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<AppPageId>(() => initialAppPage(window.location.search));
  const [platform, setPlatform] = useState('');
  const state = usePiSystemStore((s) => s.state);
  const env = usePiSystemStore((s) => s.env);
  const latestVersion = usePiSystemStore((s) => s.latestVersion);
  const detect = usePiSystemStore((s) => s.detect);
  const chatStarted = useChatStore((s) => s.started);
  const isStreaming = useChatStore((s) => s.isStreaming);

  useEffect(() => {
    const unbind = bindPiSystemEvents();
    const unbindNavigate = onNavigateToPage(setPage);
    bindChatEvents();
    void detect();
    void initTheme();
    void hostApi.app.platform().then(setPlatform);
    // 恢复保存的语言
    void hostApi.settings.get('language').then((lng) => {
      if (lng && lng !== i18n.language) void i18n.changeLanguage(lng);
    });
    return () => {
      unbind();
      unbindNavigate();
    };
  }, [detect]);

  const isMac = platform === 'darwin';
  const dragStrip = isMac ? <div className="window-drag-strip" data-testid="window-drag-strip" /> : null;

  if (state !== 'ready') {
    return (
      <>
        {dragStrip}
        <Onboarding />
      </>
    );
  }

  const newChat = () => {
    setPage('chat');
    if (chatStarted && !isStreaming) void hostApi.piRuntime.newSession();
  };

  return (
    <div className={isMac ? 'app-layout is-macos' : 'app-layout'}>
      {dragStrip}
      <nav className="sidebar">
        <button className="new-chat" data-testid="new-chat" onClick={newChat}>
          <Plus size={15} />
          {t('sidebar.newChat')}
        </button>
        <SessionList onOpenChat={() => setPage('chat')} />
        <div className="sidebar-nav">
          {PAGES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              data-testid={`nav-${id}`}
              className={page === id ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(id)}
            >
              <Icon size={15} />
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
          <SessionsPage onOpenChat={() => setPage('chat')} />
        ) : page === 'skills' ? (
          <SkillsPage />
        ) : page === 'extensions' ? (
          <ExtensionsPage />
        ) : page === 'mcp' ? (
          <McpPage />
        ) : page === 'settings' ? (
          <SettingsPage />
        ) : null}
      </main>
      <ExtensionUiDialog />
      <ExtensionUiNotifications />
    </div>
  );
}
