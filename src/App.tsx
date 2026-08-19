import { useCallback, useEffect, useState } from 'react';
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
import { getActiveChatStore } from './stores/chat-registry';
import { hostApi } from './lib/host-api';
import { onNavigateToPage } from './lib/app-navigation';
import { initTheme } from './lib/theme';
import { SessionList } from './components/SessionList';
import { SessionSearchDialog } from './components/SessionSearchDialog';
import { ExtensionUiNotifications } from './components/ExtensionUiDialog';
import { TrustDialog } from './components/TrustDialog';
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
  const [visitedPages, setVisitedPages] = useState<Set<AppPageId>>(() => new Set(['chat', initialAppPage(window.location.search)]));
  const [platform, setPlatform] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('pi-desktop.sidebar-collapsed') === 'true');
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [chatSearchTarget, setChatSearchTarget] = useState<ChatSearchTarget>();
  const state = usePiSystemStore((s) => s.state);
  const environment = usePiSystemStore((s) => s.env);
  const detect = usePiSystemStore((s) => s.detect);

  const navigate = (nextPage: AppPageId) => {
    setPage(nextPage);
    setVisitedPages((current) => current.has(nextPage) ? current : new Set(current).add(nextPage));
  };

  useEffect(() => {
    const unbind = bindPiSystemEvents();
    const unbindNavigate = onNavigateToPage(navigate);
    // 已有缓存时直接进入主界面；环境检测只在首次启动或用户手动刷新时执行。
    if (!environment) void detect();
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
  const clearChatSearchTarget = useCallback(() => setChatSearchTarget(undefined), []);

  if (state !== 'ready') {
    return (
      <>
        {dragStrip}
        <Onboarding />
      </>
    );
  }

  const newChat = () => {
    navigate('chat');
    // 走活跃面板 store 的 newSession：置位 expectingReplacement，sessionReplaced 事件据此改绑
    const store = getActiveChatStore();
    if (store?.getState().started) void store.getState().newSession();
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
      {(isMac || sidebarCollapsed) && (
        <div
          className={`app-window-controls${isMac ? '' : ' is-native-frame'}`}
          data-testid="app-window-controls"
        >
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
        {/* 非 mac 收起时顶部栏随侧栏隐藏，展开入口改由悬浮控件层提供，
            避免同一 testid 出现两份 */}
        {!isMac && !sidebarCollapsed && <div className="sidebar-topbar">
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
        <SessionList onOpenChat={() => navigate('chat')} />
        <div className="sidebar-nav">
          {PAGES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              data-testid={`nav-${id}`}
              className={page === id ? 'nav-item active' : 'nav-item'}
              title={sidebarCollapsed ? t(`nav.${id}`) : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={15} />
              <span>{t(`nav.${id}`)}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className="content">
        {visitedPages.has('chat') && <div className={`page-view${page === 'chat' ? ' active' : ''}`}><ChatPage searchTarget={chatSearchTarget} onSearchTargetHandled={clearChatSearchTarget} /></div>}
        {visitedPages.has('models') && <div className={`page-view${page === 'models' ? ' active' : ''}`}><ModelsPage /></div>}
        {visitedPages.has('sessions') && <div className={`page-view${page === 'sessions' ? ' active' : ''}`}><SessionsPage onOpenChat={() => navigate('chat')} /></div>}
        {visitedPages.has('skills') && <div className={`page-view${page === 'skills' ? ' active' : ''}`}><SkillsPage /></div>}
        {visitedPages.has('extensions') && <div className={`page-view${page === 'extensions' ? ' active' : ''}`}><ExtensionsPage /></div>}
        {visitedPages.has('mcp') && <div className={`page-view${page === 'mcp' ? ' active' : ''}`}><McpPage /></div>}
        {visitedPages.has('settings') && <div className={`page-view${page === 'settings' ? ' active' : ''}`}><SettingsPage /></div>}
      </main>
      <ExtensionUiNotifications />
      <TrustDialog />
      <SessionSearchDialog
        open={sessionSearchOpen}
        onClose={() => setSessionSearchOpen(false)}
        onOpenChat={(target) => {
          navigate('chat');
          setChatSearchTarget(target ? { ...target, nonce: Date.now() } : undefined);
        }}
      />
    </div>
  );
}
