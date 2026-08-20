import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react';
import { DEFAULT_DESKTOP_PROXY_URL, type PiSessionExportInfo, type PiTrustEntry } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
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

const PROXY_MODES = ['auto', 'off'] as const;
type ProxyMode = (typeof PROXY_MODES)[number];
type ProxyStatus = { url?: string; source?: string };

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'] as const;

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [versionStatus, setVersionStatus] = useState<Awaited<ReturnType<typeof hostApi.versionCheck.getStatus>>>();
  const [versionChecking, setVersionChecking] = useState(false);
  const [appDownloading, setAppDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [cwd, setCwd] = useState<string | undefined>();
  const [theme, setThemeState] = useState<Theme>('system');
  const [notifyMode, setNotifyMode] = useState<NotifyMode>('unfocused');
  const [followupBehavior, setFollowupBehavior] = useState<FollowupBehavior>('queue');
  const [sendWith, setSendWith] = useState<SendWith>('enter');
  const [preventSleep, setPreventSleep] = useState(false);
  const [notifyUiRequest, setNotifyUiRequest] = useState(true);
  const [compaction, setCompaction] = useState({ reserveTokens: 16384, keepRecentTokens: 20000, enabled: true });
  const [modelWindow, setModelWindow] = useState<number>();
  const [exportInfo, setExportInfo] = useState<PiSessionExportInfo>();
  const [trustEntries, setTrustEntries] = useState<PiTrustEntry[]>([]);
  const [defaultThinking, setDefaultThinking] = useState<string | null>(null);
  const [retry, setRetry] = useState({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
  const [proxyMode, setProxyMode] = useState<ProxyMode>('auto');
  const [proxyUrl, setProxyUrl] = useState(DEFAULT_DESKTOP_PROXY_URL);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>();
  const [proxyMessage, setProxyMessage] = useState<string>();
  const env = usePiSystemStore((s) => s.env);
  const detect = usePiSystemStore((s) => s.detect);

  useEffect(() => {
    void hostApi.app.version().then(setAppVersion);
    void hostApi.versionCheck.getStatus().then(setVersionStatus).catch(() => {});
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
    void hostApi.piRuntime.getUsage().then((usage) => {
      if (usage?.model?.contextWindow) setModelWindow(usage.model.contextWindow);
    }).catch(() => {});
    void hostApi.piSessions.getExportInfo().then(setExportInfo).catch(() => {});
    void hostApi.piTrust.list().then((r) => setTrustEntries(r.entries)).catch(() => {});
    void hostApi.providers.getDefaultThinking().then((r) => setDefaultThinking(r.level)).catch(() => {});
    void hostApi.providers.getRetry().then(setRetry).catch(() => {});
    void hostApi.settings.get('httpProxyMode').then((v) => {
      const mode: ProxyMode = v === 'off' ? 'off' : 'auto';
      setProxyMode(mode);
      if (v !== mode) void hostApi.settings.set('httpProxyMode', mode);
    }).catch(() => {});
    void hostApi.settings.get('httpProxyUrl').then((v) => {
      const url = typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_DESKTOP_PROXY_URL;
      setProxyUrl(url);
      if (v !== url) void hostApi.settings.set('httpProxyUrl', url);
    }).catch(() => {});
    void hostApi.proxy.detect().then(setProxyStatus).catch(() => {});
    const offTrustChanged = onHostEvent('piTrust', 'changed', (r) => setTrustEntries(r.entries));
    const offUpdateProgress = onHostEvent('appUpdate', 'progress', (event) => {
      if (event.totalBytes) setDownloadProgress(Math.round((event.downloadedBytes ?? 0) / event.totalBytes * 100));
      if (event.phase === 'completed' || event.phase === 'failed') setAppDownloading(false);
    });
    void Promise.all([hostApi.providers.listModels(), hostApi.providers.getDefaultModel()]).then(([available, current]) => {
      const model = current.model ? available.models.find((candidate) => candidate.provider === current.model?.provider && candidate.id === current.model?.id) : undefined;
      if (model?.contextWindow) setModelWindow((previous) => previous ?? model.contextWindow);
    }).catch(() => {});
    return () => {
      offTrustChanged();
      offUpdateProgress();
    };
  }, []);

  const changeLanguage = async (lng: SupportedLanguage) => {
    await i18n.changeLanguage(lng);
    await hostApi.settings.set('language', lng);
  };

  const changeTrust = async (path: string, decision: boolean | null) => {
    // main 侧写完 ProjectTrustStore 会广播 piTrust.changed 刷新列表
    await hostApi.piTrust.set(path, decision).catch(() => {});
  };

  const changeWorkspace = async () => {
    const result = await hostApi.dialog.openDirectory(t('chat.workspace.choose'));
    if (result.canceled || !result.filePaths[0]) return;
    await hostApi.settings.set('workspaceCwd', result.filePaths[0]);
    setCwd(result.filePaths[0]);
  };

  const checkVersions = async () => {
    setVersionChecking(true);
    try {
      setVersionStatus(await hostApi.versionCheck.check(true));
    } finally {
      setVersionChecking(false);
    }
  };

  const downloadAppUpdate = async () => {
    setAppDownloading(true);
    try {
      const result = await hostApi.appUpdate.download();
      if (result.success) setVersionStatus(await hostApi.versionCheck.getStatus());
    } finally {
      setAppDownloading(false);
    }
  };

  const refreshProxy = async (): Promise<void> => {
    setProxyMessage(undefined);
    const applied = await hostApi.proxy.apply().catch(() => undefined);
    if (applied && !applied.success) setProxyMessage(`${t('settings.proxy.applyFailed')}: ${applied.error ?? ''}`);
    void hostApi.proxy.detect().then(setProxyStatus).catch(() => {});
  };

  const changeProxyMode = async (mode: ProxyMode): Promise<void> => {
    setProxyMode(mode);
    await hostApi.settings.set('httpProxyMode', mode);
    await refreshProxy();
  };

  const changeProxyUrl = async (url: string): Promise<void> => {
    setProxyUrl(url);
    await hostApi.settings.set('httpProxyUrl', url);
    await refreshProxy();
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

      <section className="settings-section" data-testid="settings-proxy">
        <h2>{t('settings.proxy.title')}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.proxy.title')}</div>
            <div className="settings-row-desc">{t('settings.proxy.desc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-proxy-mode">
            {PROXY_MODES.map((mode) => (
              <button
                key={mode}
                data-testid={`proxy-mode-${mode}`}
                className={proxyMode === mode ? 'pill active' : 'pill'}
                onClick={() => void changeProxyMode(mode)}
              >
                {t(`settings.proxy.modes.${mode}`)}
              </button>
            ))}
          </div>
        </div>
        {proxyMode === 'auto' && (
          <div className="settings-row">
            <div className="settings-row-label">
              <div>{t('settings.proxy.url')}</div>
              <div className="settings-row-desc">{t('settings.proxy.urlDesc')}</div>
            </div>
            <input
              className="settings-number settings-proxy-url"
              data-testid="settings-proxy-url"
              type="text"
              placeholder={t('settings.proxy.placeholder')}
              value={proxyUrl}
              onChange={(e) => void changeProxyUrl(e.target.value)}
            />
          </div>
        )}
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.proxy.status')}</div>
            <div className="settings-row-desc" data-testid="settings-proxy-status">
              {proxyStatus?.url
                ? t('settings.proxy.detected', { url: proxyStatus.url, source: t(`settings.proxy.source.${proxyStatus.source ?? 'none'}`) })
                : t('settings.proxy.none')}
              {proxyMessage && <span className="settings-proxy-error">{proxyMessage}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" data-testid="settings-session-exports">
        <h2>{t('settings.sessionExports')}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.exportLocation')}</div>
            <div className="settings-row-desc" data-testid="settings-export-directory">
              {exportInfo?.directory ?? t('states.loading')}
            </div>
          </div>
          <button
            className="pill"
            data-testid="settings-open-export-directory"
            disabled={!exportInfo}
            onClick={() => exportInfo && void hostApi.shell.openPath(exportInfo.directory)}
          >
            <FolderOpen size={14} />
            {t('sessions.openExportFolder')}
          </button>
        </div>
      </section>

      <section className="settings-section" data-testid="settings-compaction">
        <h2>{t('settings.compaction.title')}</h2>
        <p className="settings-section-hint">{t('settings.compaction.desc')}</p>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.compaction.enabled')}</div>
            <div className="settings-row-desc">{t('settings.compaction.enabledDesc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-compaction-enabled">
            {[true, false].map((enabled) => (
              <button
                key={String(enabled)}
                data-testid={`compaction-enabled-${enabled ? 'on' : 'off'}`}
                className={compaction.enabled === enabled ? 'pill active' : 'pill'}
                onClick={() => {
                  setCompaction((current) => ({ ...current, enabled }));
                  void hostApi.providers.setCompaction({ enabled });
                }}
              >
                {t(enabled ? 'settings.toggle.on' : 'settings.toggle.off')}
              </button>
            ))}
          </div>
        </div>
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

      <section className="settings-section" data-testid="settings-agent-defaults">
        <h2>{t('settings.agentDefaults.title')}</h2>
        <p className="settings-section-hint">{t('settings.agentDefaults.desc')}</p>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.defaultThinking.title')}</div>
            <div className="settings-row-desc">{t('settings.defaultThinking.desc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-default-thinking">
            {THINKING_LEVELS.map((level) => (
              <button
                key={level}
                data-testid={`default-thinking-${level}`}
                className={defaultThinking === level ? 'pill active' : 'pill'}
                onClick={() => {
                  setDefaultThinking(level);
                  void hostApi.providers.setDefaultThinking(level);
                }}
              >
                {t(`chat.thinkingLevels.${level}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.retry.title')}</div>
            <div className="settings-row-desc">{t('settings.retry.desc')}</div>
          </div>
          <div className="pill-group" data-testid="settings-retry-enabled">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                data-testid={`retry-enabled-${on ? 'on' : 'off'}`}
                className={retry.enabled === on ? 'pill active' : 'pill'}
                onClick={() => {
                  setRetry((v) => ({ ...v, enabled: on }));
                  void hostApi.providers.setRetry({ enabled: on });
                }}
              >
                {t(on ? 'settings.toggle.on' : 'settings.toggle.off')}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.retry.maxRetries')}</div>
            <div className="settings-row-desc">{t('settings.retry.maxRetriesDesc')}</div>
          </div>
          <input
            className="settings-number"
            data-testid="retry-max-retries"
            type="number"
            min="0"
            step="1"
            value={retry.maxRetries}
            onChange={(e) => setRetry((v) => ({ ...v, maxRetries: Number(e.target.value) || 0 }))}
            onBlur={() => void hostApi.providers.setRetry({ maxRetries: retry.maxRetries })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <div>{t('settings.retry.baseDelay')}</div>
            <div className="settings-row-desc">{t('settings.retry.baseDelayDesc')}</div>
          </div>
          <input
            className="settings-number"
            data-testid="retry-base-delay"
            type="number"
            min="0"
            step="100"
            value={retry.baseDelayMs}
            onChange={(e) => setRetry((v) => ({ ...v, baseDelayMs: Number(e.target.value) || 0 }))}
            onBlur={() => void hostApi.providers.setRetry({ baseDelayMs: retry.baseDelayMs })}
          />
        </div>
      </section>

      <section className="settings-section" data-testid="settings-trust">
        <h2>{t('settings.trust.title')}</h2>
        <p className="settings-section-hint">{t('settings.trust.desc')}</p>
        {trustEntries.length === 0 ? (
          <p className="settings-section-hint" data-testid="trust-empty">{t('settings.trust.empty')}</p>
        ) : (
          trustEntries.map((entry) => (
            <div className="settings-row" key={entry.path} data-testid="trust-entry">
              <div className="settings-row-label">
                <div className="settings-trust-path" title={entry.path}>{entry.path}</div>
                <div className="settings-row-desc">
                  {t(entry.decision ? 'settings.trust.trusted' : 'settings.trust.untrusted')}
                </div>
              </div>
              <div className="pill-group">
                <button
                  className="pill"
                  data-testid="trust-toggle"
                  onClick={() => void changeTrust(entry.path, !entry.decision)}
                >
                  {t(entry.decision ? 'settings.trust.markUntrusted' : 'settings.trust.markTrusted')}
                </button>
                <button
                  className="pill"
                  data-testid="trust-revoke"
                  onClick={() => void changeTrust(entry.path, null)}
                >
                  {t('settings.trust.revoke')}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="settings-section" data-testid="settings-about">
        <h2>{t('settings.about')}</h2>
        <div className="settings-row" data-testid="settings-app-version-status">
          <div className="settings-row-label">
            <div>Pi Desktop</div>
            <div className="settings-row-desc">{t('settings.version.current', { version: appVersion })}</div>
            <div className="settings-row-desc">{versionStatus?.app.latest ? t(versionStatus.app.updateAvailable ? 'settings.version.updateAvailable' : 'settings.version.upToDate', { version: versionStatus.app.latest.replace(/^v/, '') }) : t('settings.version.notChecked')}</div>
            {versionStatus?.app.error && <div className="error-text">{t('settings.version.checkFailed')}</div>}
          </div>
          <div className="pill-group">
            <button className="pill" data-testid="settings-app-check" disabled={versionChecking} onClick={() => void checkVersions()}>{t(versionChecking ? 'settings.version.checking' : 'settings.version.checkNow')}</button>
            {versionStatus?.app.updateAvailable && <button className="pill" data-testid="settings-app-download" disabled={appDownloading} onClick={() => void downloadAppUpdate()}>{t(appDownloading ? 'settings.version.downloading' : 'settings.version.download')}{appDownloading && ` ${downloadProgress}%`}</button>}
            {versionStatus?.app.downloadedPath && <><button className="pill" data-testid="settings-app-open" onClick={() => void hostApi.appUpdate.openDownloaded()}>{t('settings.version.open')}</button><button className="pill" data-testid="settings-app-show" onClick={() => void hostApi.appUpdate.showDownloaded()}>{t('settings.version.showInFolder')}</button></>}
          </div>
        </div>
        <div className="settings-row" data-testid="settings-pi-status">
          <div className="settings-row-label">
            <div>pi</div>
            <div className="settings-row-desc">
              <div>
                {t('status.ready', { version: env?.pi.version ?? '?' })}
                {versionStatus?.pi.latest && versionStatus.pi.updateAvailable
                  ? ` · ${t('status.latestAvailable', { version: versionStatus.pi.latest })}`
                  : ''}
              </div>
              <div>{versionStatus?.pi.error ? t('settings.version.checkFailed') : t('settings.version.lastChecked', { time: versionStatus?.pi.lastSuccessAt ? new Date(versionStatus.pi.lastSuccessAt).toLocaleString() : t('settings.version.notChecked') })}</div>
              {env?.compatibility?.status === 'compatible-untested' && (
                <div className="warning">{t('status.compatibleUntested')}</div>
              )}
            </div>
          </div>
          <div className="pill-group">
            <button className="pill" data-testid="settings-recheck" onClick={() => void detect(true)}>{t('onboarding.recheck')}</button>
            <button className="pill" data-testid="settings-pi-check" disabled={versionChecking} onClick={() => void checkVersions()}>{t(versionChecking ? 'settings.version.checking' : 'settings.version.checkNow')}</button>
            {versionStatus?.pi.updateAvailable && <button className="pill" data-testid="settings-pi-upgrade" onClick={() => void usePiSystemStore.getState().install()}>{t('settings.version.upgradePi')}</button>}
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
