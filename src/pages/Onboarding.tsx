import { useTranslation } from 'react-i18next';
import { hostApi } from '../lib/host-api';
import { usePiSystemStore } from '../stores/pi-system';
import { PI_PACKAGE_NAME } from '@shared/pi-compat';

const PI_INSTALL_COMMAND = `npm i -g ${PI_PACKAGE_NAME}`;

function InstallLog() {
  const { t } = useTranslation();
  const installLog = usePiSystemStore((s) => s.installLog);
  const installPhase = usePiSystemStore((s) => s.installPhase);
  if (installPhase === 'idle' || installLog.length === 0) return null;
  return (
    <div className="install-log">
      <div className="install-log-title">{t('onboarding.installLog')}</div>
      <pre>{installLog.join('')}</pre>
    </div>
  );
}

function InstallButton({ labelKey }: { labelKey: string }) {
  const { t } = useTranslation();
  const installPhase = usePiSystemStore((s) => s.installPhase);
  const install = usePiSystemStore((s) => s.install);
  return (
    <button
      className="primary"
      disabled={installPhase === 'running'}
      onClick={() => void install()}
    >
      {installPhase === 'running' ? t('onboarding.installing') : t(labelKey)}
    </button>
  );
}

export default function Onboarding() {
  const { t } = useTranslation();
  const env = usePiSystemStore((s) => s.env);
  const state = usePiSystemStore((s) => s.state);
  const checking = usePiSystemStore((s) => s.checking);
  const detect = usePiSystemStore((s) => s.detect);
  const installPhase = usePiSystemStore((s) => s.installPhase);
  const installError = usePiSystemStore((s) => s.installError);

  if (!env || !state) {
    return (
      <div className="onboarding">
        <h1>Pi Desktop</h1>
        <p>{t('onboarding.checking')}</p>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <h1>Pi Desktop</h1>
      <p className="tagline">{t('app.tagline')}</p>

      {state === 'no-node' && (
        <section>
          <h2>{t('onboarding.noNode.title')}</h2>
          <p>{t('onboarding.noNode.body', { min: env.minNodeVersion })}</p>
          <p className="detect-detail">
            {!env.node.found
              ? t('onboarding.noNode.notFound')
              : !env.node.meetsMin
                ? t('onboarding.noNode.detected', { version: env.node.version, min: env.minNodeVersion })
                : t('onboarding.noNode.npmNotFound', { version: env.node.version })}
          </p>
          <div className="actions">
            <button
              className="primary"
              onClick={() => void hostApi.shell.openExternal('https://nodejs.org/')}
            >
              {t('onboarding.noNode.download')}
            </button>
            <button disabled={checking} onClick={() => void detect(true)}>
              {t('onboarding.recheck')}
            </button>
          </div>
        </section>
      )}

      {state === 'no-pi' && (
        <section>
          <h2>{t('onboarding.noPi.title')}</h2>
          <p>{t('onboarding.noPi.body')}</p>
          <code className="command">{PI_INSTALL_COMMAND}</code>
          <p className="hint">{t('onboarding.noPi.hint')}</p>
          <div className="actions">
            <InstallButton labelKey="onboarding.install" />
            <button disabled={checking} onClick={() => void detect(true)}>
              {t('onboarding.recheck')}
            </button>
          </div>
        </section>
      )}

      {state === 'non-npm' && (
        <section>
          <h2>{t('onboarding.nonNpm.title')}</h2>
          <p>
            {t('onboarding.nonNpm.body', {
              version: env.pi.version,
              path: env.pi.realBinPath ?? env.pi.binPath,
            })}
          </p>
          <p className="hint">{t('onboarding.nonNpm.lossless')}</p>
          {env.pi.npmInstalledVersion && (
            <p className="warning">
              {t('onboarding.nonNpm.shadowed', {
                version: env.pi.npmInstalledVersion,
                binPath: env.pi.binPath,
              })}
            </p>
          )}
          <div className="actions">
            <InstallButton labelKey="onboarding.nonNpm.switch" />
            <button disabled={checking} onClick={() => void detect(true)}>
              {t('onboarding.recheck')}
            </button>
          </div>
        </section>
      )}

      {state === 'pi-outdated' && (
        <section>
          <h2>{t('onboarding.outdated.title')}</h2>
          <p>
            {t('onboarding.outdated.body', { current: env.pi.version, min: env.minPiVersion })}
          </p>
          <code className="command">{PI_INSTALL_COMMAND}</code>
          <div className="actions">
            <InstallButton labelKey="onboarding.outdated.upgrade" />
            <button disabled={checking} onClick={() => void detect(true)}>
              {t('onboarding.recheck')}
            </button>
          </div>
        </section>
      )}

      {state === 'pi-incompatible' && (
        <section className="error">
          <h2>{t('onboarding.incompatible.title')}</h2>
          <p>{t('onboarding.incompatible.body')}</p>
          {env.compatibility?.missingRequiredCapabilities.length ? (
            <pre className="error-detail">{env.compatibility.missingRequiredCapabilities.join(', ')}</pre>
          ) : null}
          <code className="command">{PI_INSTALL_COMMAND}</code>
          <div className="actions">
            <InstallButton labelKey="onboarding.incompatible.install" />
            <button disabled={checking} onClick={() => void detect(true)}>
              {t('onboarding.recheck')}
            </button>
          </div>
        </section>
      )}

      {installPhase === 'failed' && (
        <section className="error">
          <h2>{t('onboarding.failed.title')}</h2>
          <p>{t('onboarding.failed.detail')}</p>
          {installError && <pre className="error-detail">{installError}</pre>}
        </section>
      )}

      <InstallLog />
    </div>
  );
}
