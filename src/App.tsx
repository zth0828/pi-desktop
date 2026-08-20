import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  History,
  MessageSquare,
  Minus,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import logoUrl from '../resources/icon.png';
import { bindPiSystemEvents, usePiSystemStore } from './stores/pi-system';
import { getActiveChatStore } from './stores/chat-registry';
import { hostApi } from './lib/host-api';
import { onNavigateToPage } from './lib/app-navigation';
import { initTheme } from './lib/theme';
import { windowChrome } from './lib/window-chrome';
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

// Row 1 菜单栏分组（与 VSCode Windows 标题栏一致；文案全部走 menu.* i18n）。
const MENU_GROUPS = ['file', 'edit', 'selection', 'view', 'go', 'run', 'terminal', 'help'] as const;
type MenuGroup = (typeof MENU_GROUPS)[number];

type ChatSearchTarget = { sessionId: string; messageIndex: number; nonce: number };

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<AppPageId>(() => initialAppPage(window.location.search));
  const [visitedPages, setVisitedPages] = useState<Set<AppPageId>>(() => new Set(['chat', initialAppPage(window.location.search)]));
  // preload 同步暴露平台：首帧即渲染正确的标题栏形态，避免 mac 闪现 Windows chrome。
  const [platform, setPlatform] = useState(() => window.pidesktop?.platform ?? '');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('pi-desktop.sidebar-collapsed') === 'true');
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [chatSearchTarget, setChatSearchTarget] = useState<ChatSearchTarget>();
  const [openMenu, setOpenMenu] = useState<MenuGroup | null>(null);
  const [maximized, setMaximized] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
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

  // frameless 自绘窗口控件：同步真实最大化状态（用户也可用系统快捷键最大化）。
  const isMac = platform === 'darwin';
  useEffect(() => {
    if (isMac) return;
    void hostApi.windows.isMaximized().then(setMaximized);
  }, [isMac]);

  // 菜单下拉：点击外部或 Esc 关闭（菜单按钮自身 onClick 负责切换）。
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

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

  const toggleMaximize = () => {
    void hostApi.windows.maximizeToggle().then(() => hostApi.windows.isMaximized()).then(setMaximized);
  };

  // Row 1 菜单下拉动作（renderer 完成执行；main 只提供窗口控制）。
  const menuItems: Record<MenuGroup, Array<{ key: string; action?: () => void; disabled?: boolean }>> = {
    file: [
      { key: 'menu.newChat', action: newChat },
      { key: 'menu.closeWindow', action: () => void hostApi.windows.close() },
    ],
    edit: [
      { key: 'menu.copy', disabled: true },
      { key: 'menu.paste', disabled: true },
    ],
    view: [
      { key: 'menu.collapseSidebar', action: toggleSidebar },
      { key: 'menu.searchChats', action: () => setSessionSearchOpen(true) },
    ],
    selection: [{ key: 'menu.comingSoon', disabled: true }],
    go: [{ key: 'menu.comingSoon', disabled: true }],
    run: [{ key: 'menu.comingSoon', disabled: true }],
    terminal: [{ key: 'menu.comingSoon', disabled: true }],
    help: [{ key: 'menu.comingSoon', disabled: true }],
  };

  // Row 2 工具行挂载时注册会话标题 portal 插槽（Chat 页标题栏注入）。
  const toolbarRef = useCallback((element: HTMLDivElement | null) => {
    windowChrome.toolbar = element;
  }, []);

  const dragStrip = isMac ? <div className="window-drag-strip" data-testid="window-drag-strip" /> : null;
  const clearChatSearchTarget = useCallback(() => setChatSearchTarget(undefined), []);

  // Windows/Linux frameless 顶部：Row 1 标题栏（logo + 菜单 + 窗口控件）+
  // Row 2 工具行（新会话/折叠/搜索 + 会话标题 portal 插槽）。Row 1 是拖拽区。
  // 未就绪（onboarding）时只渲染标题栏行，保证窗口可拖动、可最小化/关闭。
  const chrome = (
    <div className="window-chrome" data-testid="window-chrome">
      <div className="titlebar" data-testid="titlebar">
        <img className="titlebar-logo" src={logoUrl} alt="" draggable={false} />
        {state === 'ready' && (
          <div className="menu-bar" role="menubar" aria-label={t('menu.label')} data-testid="menu-bar" ref={menuBarRef}>
            {MENU_GROUPS.map((group) => (
              <div key={group} className="menu-wrap">
                <button
                  className={`menu-item${openMenu === group ? ' open' : ''}`}
                  data-testid={`menu-${group}`}
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === group}
                  onClick={() => setOpenMenu((current) => (current === group ? null : group))}
                >
                  {t(`menu.${group}`)}
                </button>
                {openMenu === group && (
                  <div className="menu-dropdown" role="menu" data-testid={`menu-dropdown-${group}`}>
                    {menuItems[group].map((item, index) => (
                      <button
                        key={item.key}
                        className="menu-dropdown-item"
                        role="menuitem"
                        data-testid={`menu-item-${group}-${index}`}
                        disabled={item.disabled}
                        onClick={() => {
                          setOpenMenu(null);
                          item.action?.();
                        }}
                      >
                        {t(item.key)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="titlebar-spacer" />
        <div className="window-controls" data-testid="app-window-controls">
          <button
            className="window-control"
            data-testid="window-minimize"
            title={t('menu.minimize')}
            aria-label={t('menu.minimize')}
            onClick={() => void hostApi.windows.minimize()}
          >
            <Minus size={14} />
          </button>
          <button
            className="window-control"
            data-testid="window-maximize"
            title={maximized ? t('menu.restore') : t('menu.maximize')}
            aria-label={maximized ? t('menu.restore') : t('menu.maximize')}
            onClick={toggleMaximize}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className="window-control window-control-close"
            data-testid="window-close"
            title={t('menu.close')}
            aria-label={t('menu.close')}
            onClick={() => void hostApi.windows.close()}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {state === 'ready' && (
        <div className="toolbar" data-testid="toolbar">
          <button className="toolbar-new-chat" data-testid="new-chat" title={t('sidebar.newChat')} onClick={newChat}>
            <Plus size={15} />
            <span>{t('sidebar.newChat')}</span>
          </button>
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
          {/* Chat 页 session-titlebar 的 portal 注入点：标题居中、动作靠右 */}
          <div className="toolbar-center" ref={toolbarRef} data-testid="toolbar-center" />
        </div>
      )}
    </div>
  );

  if (state !== 'ready') {
    return (
      <>
        {dragStrip}
        {!isMac && chrome}
        <Onboarding />
      </>
    );
  }

  return (
    <div className={`${isMac ? 'app-layout is-macos' : 'app-layout'}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {chrome}
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
        {/* macOS：新会话入口保留在侧栏（Windows/Linux 收进 Row 2 工具行） */}
        {isMac && (
          <button className="new-chat" data-testid="new-chat" title={sidebarCollapsed ? t('sidebar.newChat') : undefined} onClick={newChat}>
            <Plus size={15} />
            <span>{t('sidebar.newChat')}</span>
          </button>
        )}
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
