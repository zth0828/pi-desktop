import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { bindPiSystemEvents, usePiSystemStore } from './stores/pi-system';
import Onboarding from './pages/Onboarding';

export default function App() {
  const { t } = useTranslation();
  const state = usePiSystemStore((s) => s.state);
  const env = usePiSystemStore((s) => s.env);
  const latestVersion = usePiSystemStore((s) => s.latestVersion);
  const detect = usePiSystemStore((s) => s.detect);

  useEffect(() => {
    const unbind = bindPiSystemEvents();
    void detect();
    return unbind;
  }, [detect]);

  if (state !== 'ready') {
    return <Onboarding />;
  }

  // M1 占位主界面：聊天 UI 在 M2 移植
  return (
    <div className="app-shell">
      <h1>Pi Desktop</h1>
      <p>{t('status.ready', { version: env?.pi.version })}</p>
      {latestVersion && latestVersion !== env?.pi.version && (
        <p className="hint">{t('status.latestAvailable', { version: latestVersion })}</p>
      )}
    </div>
  );
}
