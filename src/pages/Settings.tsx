import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import { hostApi } from '../lib/host-api';
import { setTheme, type Theme } from '../lib/theme';
import { usePiSystemStore } from '../stores/pi-system';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../lib/i18n';

const THEMES: Array<{ id: Theme; icon: typeof Sun }> = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
  { id: 'system', icon: Monitor },
];

const NOTIFY_MODES = ['always', 'unfocused', 'off'] as const;
type NotifyMode = (typeof NOTIFY_MODES)[number];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [cwd, setCwd] = useState<string | undefined>();
  const [theme, setThemeState] = useState<Theme>('system');
  const [notifyMode, setNotifyMode] = useState<NotifyMode>('unfocused');
  const env = usePiSystemStore((s) => s.env);
  const latestVersion = usePiSystemStore((s) => s.latestVersion);
  const detect = usePiSystemStore((s) => s.detect);

  useEffect(() => {
    void hostApi.app.version().then(setAppVersion);
    void hostApi.settings.get('workspaceCwd').then(setCwd);
    void hostApi.settings.get('theme').then((v) => setThemeState((v as Theme) ?? 'system'));
    void hostApi.settings.get('notifyMode').then((v) => setNotifyMode((v as NotifyMode) ?? 'unfocused'));
  }, []);

  const changeLanguage = async (lng: SupportedLanguage) => {
    await i18n.changeLanguage(lng);
    await hostApi.settings.set('language', lng);
  };

  const changeWorkspace = async () => {
    const result = await hostApi.dialog.openDirectory(t('chat.workspace.choose'));
    if (result.canceled || !result.filePaths[0]) return;
    await hostApi.settings.set('workspaceCwd', result.filePaths[0]);
    setCwd(result.filePaths[0]);
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
        <p className="page-subtitle">{t('settings.subtitle')}</p>
      </header>

      <section className="settings-section">
        <h2>{t('settings.general')}</h2>

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.theme')}</div>
          </div>
          <div className="pill-group" data-testid="settings-theme">
            {THEMES.map(({ id, icon: Icon }) => (
              <button
                key={id}
                data-testid={`theme-${id}`}
                className={theme === id ? 'pill active' : 'pill'}
                onClick={() => {
                  setThemeState(id);
                  void setTheme(id);
                }}
              >
                <Icon size={14} />
                {t(`settings.themeOptions.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row" data-testid="settings-language">
          <div className="settings-row-label">
            <div>{t('settings.language')}</div>
          </div>
          <div className="pill-group">
            {SUPPORTED_LANGUAGES.map((lng) => (
              <button
                key={lng}
                data-testid={`lang-${lng}`}
                className={i18n.language === lng ? 'pill active' : 'pill'}
                onClick={() => void changeLanguage(lng)}
              >
                {lng === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.workspace')}</div>
            <div className="settings-row-desc">{cwd ?? t('settings.noWorkspace')}</div>
          </div>
          <button className="pill" onClick={() => void changeWorkspace()}>
            {t('chat.workspace.change')}
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('notify.title')}</div>
            <div className="settings-row-desc">{t('notify.desc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-notify-mode">
            {NOTIFY_MODES.map((mode) => (
              <button
                key={mode}
                data-testid={`notify-mode-${mode}`}
                className={notifyMode === mode ? 'pill active' : 'pill'}
                onClick={() => {
                  setNotifyMode(mode);
                  void hostApi.settings.set('notifyMode', mode);
                }}
              >
                {t(`notify.mode.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t('settings.about')}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>Pi Desktop</div>
            <div className="settings-row-desc">v{appVersion}</div>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>pi</div>
            <div className="settings-row-desc">
              v{env?.pi.version ?? '?'}
              {latestVersion && latestVersion !== env?.pi.version
                ? ` · ${t('status.latestAvailable', { version: latestVersion })}`
                : ''}
            </div>
          </div>
          <div className="pill-group">
            <button className="pill" data-testid="settings-recheck" onClick={() => void detect(true)}>
              {t('onboarding.recheck')}
            </button>
            <button
              className="pill"
              onClick={() => void hostApi.shell.openExternal('https://github.com/badlogic/pi-mono')}
            >
              GitHub
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
