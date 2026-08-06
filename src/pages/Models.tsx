import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiProviderRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';

function ProviderRow({ provider, onChanged }: { provider: PiProviderRow; onChanged: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const setApiKey = async () => {
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.setApiKey(provider.id, key.trim());
    setBusy(false);
    if (result.success) {
      setKey('');
      onChanged();
    } else {
      setMessage(result.error);
    }
  };

  const startOAuth = async () => {
    setBusy(true);
    const result = await hostApi.providers.startOAuth(provider.id);
    setBusy(false);
    if (!result.success) setMessage(result.error);
  };

  const remove = async () => {
    await hostApi.providers.removeCredential(provider.id);
    onChanged();
  };

  return (
    <div className="provider-row" data-testid={`provider-${provider.id}`}>
      <button className="provider-row-header" onClick={() => setExpanded((v) => !v)}>
        <span
          className={provider.configured ? 'status-dot configured' : 'status-dot'}
          data-testid={`provider-status-${provider.id}`}
        />
        <span className="provider-name">{provider.name}</span>
        <span className="hint">{provider.id}</span>
        <span className="hint">{t('models.modelCount', { count: provider.modelCount })}</span>
      </button>
      {expanded && (
        <div className="provider-row-body">
          {provider.authMethods.includes('api_key') && (
            <div className="key-form">
              <input
                type="password"
                data-testid={`key-input-${provider.id}`}
                placeholder={t('models.keyPlaceholder')}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="primary" disabled={busy || !key.trim()} onClick={() => void setApiKey()}>
                {t('models.saveKey')}
              </button>
            </div>
          )}
          {provider.authMethods.includes('oauth') && (
            <button disabled={busy} onClick={() => void startOAuth()}>
              {t('models.oauth')}
            </button>
          )}
          {provider.configured && (
            <button className="danger-outline" onClick={() => void remove()}>
              {t('models.removeKey')}
            </button>
          )}
          {message && <p className="error-text">{message}</p>}
        </div>
      )}
    </div>
  );
}

function CustomProviderForm({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelIds, setModelIds] = useState('');
  const [message, setMessage] = useState<string>();

  const submit = async () => {
    const models = modelIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((mid) => ({ id: mid }));
    const result = await hostApi.providers.addCustom({
      id: id.trim(),
      baseUrl: baseUrl.trim(),
      api: 'openai-completions',
      apiKey: apiKey.trim() || undefined,
      models,
    });
    if (result.success) {
      setOpen(false);
      setMessage(undefined);
      onAdded();
    } else {
      setMessage(result.error);
    }
  };

  if (!open) {
    return (
      <button data-testid="add-custom-provider" onClick={() => setOpen(true)}>
        {t('models.addCustom')}
      </button>
    );
  }
  return (
    <div className="custom-provider-form" data-testid="custom-provider-form">
      <input placeholder={t('models.customId')} value={id} onChange={(e) => setId(e.target.value)} />
      <input placeholder="baseURL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <input
        placeholder={t('models.keyPlaceholder')}
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <input
        placeholder={t('models.customModels')}
        value={modelIds}
        onChange={(e) => setModelIds(e.target.value)}
      />
      <div className="actions">
        <button className="primary" disabled={!id.trim() || !baseUrl.trim() || !modelIds.trim()} onClick={() => void submit()}>
          {t('models.saveCustom')}
        </button>
        <button onClick={() => setOpen(false)}>{t('models.cancel')}</button>
      </div>
      {message && <p className="error-text">{message}</p>}
    </div>
  );
}

export default function ModelsPage() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<PiProviderRow[]>([]);
  const [oauthMessages, setOauthMessages] = useState<string[]>([]);

  const refresh = () => {
    void hostApi.providers.list().then((r) => setProviders(r.providers));
  };

  useEffect(() => {
    refresh();
    return onHostEvent('providers', 'oauthProgress', ({ event }) => {
      const url = (event as { url?: string }).url;
      if (url) {
        setOauthMessages((prev) => [...prev, url]);
        void hostApi.shell.openExternal(url);
      }
    });
  }, []);

  return (
    <div className="models-page">
      <h2>{t('models.title')}</h2>
      {oauthMessages.length > 0 && (
        <div className="hint" data-testid="oauth-progress">
          {t('models.oauthStarted')}
        </div>
      )}
      <div className="provider-list">
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} onChanged={refresh} />
        ))}
      </div>
      <CustomProviderForm onAdded={refresh} />
    </div>
  );
}
