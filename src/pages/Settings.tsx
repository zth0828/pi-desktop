import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '../lib/host-api';
import { usePiSystemStore } from '../stores/pi-system';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../lib/i18n';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [cwd, setCwd] = useState<string | undefined>();
  const env = usePiSystemStore((s) => s.env);
  const latestVersion = usePiSystemStore((s) => s.latestVersion);
  const detect = usePiSystemStore((s) => s.detect);

  useEffect(() => {
    void hostApi.app.version().then(setAppVersion);
    void hostApi.settings.get('workspaceCwd').then(setCwd);
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
    <div className="settings-page">
      <h2>{t('settings.title')}</h2>

      <section data-testid="settings-language">
        <h3>{t('settings.language')}</h3>
        <div className="actions">
          {SUPPORTED_LANGUAGES.map((lng) => (
            <button
              key={lng}
              data-testid={`lang-${lng}`}
              className={i18n.language === lng ? 'primary' : ''}
              onClick={() => void changeLanguage(lng)}
            >
              {lng === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>{t('settings.workspace')}</h3>
        <p className="hint">{cwd ?? t('settings.noWorkspace')}</p>
        <button onClick={() => void changeWorkspace()}>{t('chat.workspace.change')}</button>
      </section>

      <section>
        <h3>{t('settings.versions')}</h3>
        <p>Pi Desktop v{appVersion}</p>
        <p>
          pi v{env?.pi.version ?? '?'}
          {latestVersion && latestVersion !== env?.pi.version && (
            <span className="hint">（{t('status.latestAvailable', { version: latestVersion })}）</span>
          )}
        </p>
        <div className="actions">
          <button data-testid="settings-recheck" onClick={() => void detect(true)}>
            {t('onboarding.recheck')}
          </button>
          <button onClick={() => void hostApi.shell.openExternal('https://github.com/badlogic/pi-mono')}>
            pi GitHub
          </button>
        </div>
      </section>
    </div>
  );
}
