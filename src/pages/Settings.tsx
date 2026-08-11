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

const FOLLOWUP_BEHAVIORS = ['queue', 'steer'] as const;
type FollowupBehavior = (typeof FOLLOWUP_BEHAVIORS)[number];

const SEND_WITH_MODES = ['enter', 'cmdEnter'] as const;
type SendWith = (typeof SEND_WITH_MODES)[number];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [cwd, setCwd] = useState<string | undefined>();
  const [theme, setThemeState] = useState<Theme>('system');
  const [notifyMode, setNotifyMode] = useState<NotifyMode>('unfocused');
  const [followupBehavior, setFollowupBehavior] = useState<FollowupBehavior>('queue');
  const [sendWith, setSendWith] = useState<SendWith>('enter');
  const [preventSleep, setPreventSleep] = useState(false);
  const [notifyUiRequest, setNotifyUiRequest] = useState(true);
  const [compaction, setCompaction] = useState({ reserveTokens: 16384, keepRecentTokens: 20000, enabled: true });
  const [modelWindow, setModelWindow] = useState<number>();
  const env = usePiSystemStore((s) => s.env);
  const latestVersion = usePiSystemStore((s) => s.latestVersion);
  const detect = usePiSystemStore((s) => s.detect);

  useEffect(() => {
    void hostApi.app.version().then(setAppVersion);
    void hostApi.settings.get('workspaceCwd').then(setCwd);
    void hostApi.settings.get('theme').then((v) => setThemeState((v as Theme) ?? 'system'));
    void hostApi.settings.get('notifyMode').then((v) => setNotifyMode((v as NotifyMode) ?? 'unfocused'));
    void hostApi.settings
      .get('followupBehavior')
      .then((v) => setFollowupBehavior(v === 'steer' ? 'steer' : 'queue'));
    void hostApi.settings.get('sendWith').then((v) => setSendWith(v === 'cmdEnter' ? 'cmdEnter' : 'enter'));
    void hostApi.settings.get('preventSleep').then((v) => setPreventSleep(v === true));
    void hostApi.settings.get('notifyUiRequest').then((v) => setNotifyUiRequest(v !== false));
    void hostApi.providers.getCompaction().then(setCompaction).catch(() => {});
    void Promise.all([hostApi.providers.listModels(), hostApi.providers.getDefaultModel()]).then(([available, current]) => {
      const model = current.model ? available.models.find((candidate) => candidate.provider === current.model?.provider && candidate.id === current.model?.id) : undefined;
      if (model?.contextWindow) setModelWindow(model.contextWindow);
    }).catch(() => {});
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

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.notifyUiRequest')}</div>
            <div className="settings-row-desc">{t('settings.notifyUiRequestDesc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-notify-ui-request">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                data-testid={`notify-ui-request-${on ? 'on' : 'off'}`}
                className={notifyUiRequest === on ? 'pill active' : 'pill'}
                onClick={() => {
                  setNotifyUiRequest(on);
                  void hostApi.settings.set('notifyUiRequest', on);
                }}
              >
                {t(on ? 'settings.toggle.on' : 'settings.toggle.off')}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section" data-testid="settings-compaction">
        <h2>{t('settings.compaction.title')}</h2>
        <p className="settings-section-hint">{t('settings.compaction.desc')}</p>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.compaction.reserveTokens')}</div>
            <div className="settings-row-desc">{t('settings.compaction.reserveDesc')}</div>
          </div>
          <input className="settings-number" data-testid="compaction-reserve" type="number" min="0" step="256" value={compaction.reserveTokens} onChange={(e) => setCompaction((v) => ({ ...v, reserveTokens: Number(e.target.value) || 0 }))} onBlur={() => void hostApi.providers.setCompaction({ reserveTokens: compaction.reserveTokens })} />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.compaction.keepRecentTokens')}</div>
            <div className="settings-row-desc">{t('settings.compaction.keepRecentDesc')}</div>
          </div>
          <input className="settings-number" data-testid="compaction-keep-recent" type="number" min="0" step="256" value={compaction.keepRecentTokens} onChange={(e) => setCompaction((v) => ({ ...v, keepRecentTokens: Number(e.target.value) || 0 }))} onBlur={() => void hostApi.providers.setCompaction({ keepRecentTokens: compaction.keepRecentTokens })} />
        </div>
        <p className="settings-section-hint">{modelWindow ? t('settings.compaction.recommendation', { window: modelWindow.toLocaleString(), tokens: Math.round(modelWindow * 0.25).toLocaleString() }) : t('settings.compaction.recommendationGeneric')}</p>
      </section>

      <section className="settings-section">
        <h2>{t('settings.agent')}</h2>

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.followupBehavior')}</div>
            <div className="settings-row-desc">{t('settings.followupBehaviorDesc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-followup-behavior">
            {FOLLOWUP_BEHAVIORS.map((mode) => (
              <button
                key={mode}
                data-testid={`followup-${mode}`}
                className={followupBehavior === mode ? 'pill active' : 'pill'}
                onClick={() => {
                  setFollowupBehavior(mode);
                  void hostApi.settings.set('followupBehavior', mode);
                }}
              >
                {t(`settings.followupOptions.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.sendWith')}</div>
            <div className="settings-row-desc">{t('settings.sendWithDesc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-send-with">
            {SEND_WITH_MODES.map((mode) => (
              <button
                key={mode}
                data-testid={`send-with-${mode}`}
                className={sendWith === mode ? 'pill active' : 'pill'}
                onClick={() => {
                  setSendWith(mode);
                  void hostApi.settings.set('sendWith', mode);
                }}
              >
                {t(`settings.sendWithOptions.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.preventSleep')}</div>
            <div className="settings-row-desc">{t('settings.preventSleepDesc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-prevent-sleep">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                data-testid={`prevent-sleep-${on ? 'on' : 'off'}`}
                className={preventSleep === on ? 'pill active' : 'pill'}
                onClick={() => {
                  setPreventSleep(on);
                  void hostApi.settings.set('preventSleep', on);
                }}
              >
                {t(on ? 'settings.toggle.on' : 'settings.toggle.off')}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section" data-testid="settings-about">
        <h2>{t('settings.about')}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>Pi Desktop</div>
            <div className="settings-row-desc">v{appVersion}</div>
          </div>
        </div>
        <div className="settings-row" data-testid="settings-pi-status">
          <div className="settings-row-label">
            <div>pi</div>
            <div className="settings-row-desc">
              {t('status.ready', { version: env?.pi.version ?? '?' })}
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
