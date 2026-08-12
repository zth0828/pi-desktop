import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  MessageSquare,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { bindPiSystemEvents, usePiSystemStore } from './stores/pi-system';
import { bindChatEvents, useChatStore } from './stores/chat';
import { hostApi } from './lib/host-api';
import { onNavigateToPage } from './lib/app-navigation';
import { initTheme } from './lib/theme';
import { SessionList } from './components/SessionList';
import { SessionSearchDialog } from './components/SessionSearchDialog';
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

type ChatSearchTarget = { sessionId: string; messageIndex: number; nonce: number };

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<AppPageId>(() => initialAppPage(window.location.search));
  const [platform, setPlatform] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('pi-desktop.sidebar-collapsed') === 'true');
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [chatSearchTarget, setChatSearchTarget] = useState<ChatSearchTarget>();
  const state = usePiSystemStore((s) => s.state);
  const detect = usePiSystemStore((s) => s.detect);
  const chatStarted = useChatStore((s) => s.started);

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

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setSessionSearchOpen(true);
      }
    };
    document.addEventListener('keydown', openSearch);
    return () => document.removeEventListener('keydown', openSearch);
  }, []);

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
    if (chatStarted) void hostApi.piRuntime.newSession();
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('pi-desktop.sidebar-collapsed', String(next));
      return next;
    });
  };

  return (
    <div className={`${isMac ? 'app-layout is-macos' : 'app-layout'}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {dragStrip}
      {isMac && (
        <div className="app-window-controls" data-testid="app-window-controls">
          <button
            className="icon-button sidebar-toggle"
            data-testid="sidebar-toggle"
            title={t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
            aria-label={t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
            aria-expanded={!sidebarCollapsed}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            className="icon-button session-search-trigger"
            data-testid="session-search-trigger"
            title={t('sessionSearch.title')}
            aria-label={t('sessionSearch.title')}
            aria-haspopup="dialog"
            onClick={() => setSessionSearchOpen(true)}
          >
            <Search size={17} />
          </button>
        </div>
      )}
      <nav className="sidebar">
        {!isMac && <div className="sidebar-topbar">
          <button
            className="icon-button sidebar-toggle"
            data-testid="sidebar-toggle"
            title={t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
            aria-label={t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
            aria-expanded={!sidebarCollapsed}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            className="icon-button session-search-trigger"
            data-testid="session-search-trigger"
            title={t('sessionSearch.title')}
            aria-label={t('sessionSearch.title')}
            aria-haspopup="dialog"
            onClick={() => setSessionSearchOpen(true)}
          >
            <Search size={17} />
          </button>
        </div>}
        <button className="new-chat" data-testid="new-chat" title={sidebarCollapsed ? t('sidebar.newChat') : undefined} onClick={newChat}>
          <Plus size={15} />
          <span>{t('sidebar.newChat')}</span>
        </button>
        {!sidebarCollapsed && <SessionList onOpenChat={() => setPage('chat')} />}
        <div className="sidebar-nav">
          {PAGES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              data-testid={`nav-${id}`}
              className={page === id ? 'nav-item active' : 'nav-item'}
              title={sidebarCollapsed ? t(`nav.${id}`) : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={15} />
              <span>{t(`nav.${id}`)}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className="content">
        {page === 'chat' ? (
          <ChatPage
            searchTarget={chatSearchTarget}
            onSearchTargetHandled={() => setChatSearchTarget(undefined)}
          />
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
      <SessionSearchDialog
        open={sessionSearchOpen}
        onClose={() => setSessionSearchOpen(false)}
        onOpenChat={(target) => {
          setPage('chat');
          setChatSearchTarget(target ? { ...target, nonce: Date.now() } : undefined);
        }}
      />
    </div>
  );
}
