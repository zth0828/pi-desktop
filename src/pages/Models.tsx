import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import type { PiDefaultModel, PiModelRow, PiProviderProbeResult, PiProviderRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { useChatStore } from '../stores/chat';

const CUSTOM_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;

type ProviderRowProps = {
  provider: PiProviderRow;
  /** 该供应商已配置凭证后的可用模型（providers.listModels 按 provider 分组）。 */
  models: PiModelRow[];
  defaultModel: PiDefaultModel | null;
  onChanged: () => void;
  onDefaultChanged: (model: PiDefaultModel) => void;
};

function modelDisplayName(model: PiModelRow, provider: PiProviderRow): string {
  let name = model.name ?? model.id;
  for (const suffix of [provider.id, provider.name, model.providerLabel]) {
    if (!suffix) continue;
    if (name.toLowerCase().endsWith(` (${suffix.toLowerCase()})`)) {
      name = name.slice(0, -(suffix.length + 3));
    }
  }
  return name;
}

function formatRate(rate: number): string {
  return rate === 0 ? '$0' : `$${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function ProviderRow({ provider, models, defaultModel, onChanged, onDefaultChanged }: ProviderRowProps) {
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
      if (result.discoveryError) {
        setMessage(t('models.discoveryFailed', { message: result.discoveryError }));
      } else if (result.discoveredModels) {
        setMessage(t('models.discoveryComplete', {
          count: result.discoveredModels,
          added: result.addedModels ?? 0,
        }));
      }
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
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.removeCredential(provider.id);
    setBusy(false);
    if (result.success) onChanged();
    else setMessage(result.error);
  };

  const deleteCustom = async () => {
    if (!window.confirm(t('models.deleteProviderConfirm', { name: provider.name }))) return;
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.deleteCustom(provider.id);
    setBusy(false);
    if (result.success) onChanged();
    else setMessage(result.error);
  };

  const setCurrent = async (modelId: string) => {
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.setDefaultModel(provider.id, modelId);
    setBusy(false);
    if (result.success) {
      const runtimeState = await hostApi.piRuntime.getState().catch(() => null);
      if (runtimeState?.model) {
        useChatStore.getState().applyModelUpdate({
          success: true,
          model: runtimeState.model,
          thinkingLevel: runtimeState.thinkingLevel,
          availableThinkingLevels: runtimeState.availableThinkingLevels,
          contextUsage: runtimeState.contextUsage,
        });
      }
      onDefaultChanged({ provider: provider.id, id: modelId });
    } else {
      setMessage(result.error);
    }
  };

  const isDefault = (modelId: string) =>
    defaultModel?.provider === provider.id && defaultModel.id === modelId;

  return (
    <div className="provider-row" data-testid={`provider-${provider.id}`}>
      <button className="provider-row-header" onClick={() => setExpanded((v) => !v)}>
        <span
          className={provider.configured ? 'status-dot configured' : 'status-dot'}
          data-testid={`provider-status-${provider.id}`}
        />
        <span className="provider-name">{provider.name}</span>
        <span className="hint">{provider.id}</span>
        <span className="provider-source">{t(`models.source.${provider.source}`)}</span>
        <span className="spacer" />
        <span
          className={provider.configured ? 'provider-state configured' : 'provider-state'}
          data-testid={`provider-state-${provider.id}`}
        >
          {provider.configured ? t('models.configured') : t('models.notConfigured')}
        </span>
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
            <button
              className="danger-outline"
              data-testid={`remove-credential-${provider.id}`}
              disabled={busy}
              onClick={() => void remove()}
            >
              {t('models.removeKey')}
            </button>
          )}
          {provider.source === 'config' && (
            <button
              className="danger-outline"
              data-testid={`delete-provider-${provider.id}`}
              disabled={busy}
              onClick={() => void deleteCustom()}
            >
              {t('models.deleteProvider')}
            </button>
          )}
          {provider.configured && (
            <div className="provider-models" data-testid={`provider-models-${provider.id}`}>
              <div className="provider-models-title">{t('models.availableModels')}</div>
              {models.length === 0 ? (
                <div className="hint">{t('models.noAvailableModels')}</div>
              ) : (
                models.map((m) => (
                  <div
                    className="provider-model-row"
                    key={m.id}
                    data-testid={`provider-model-${provider.id}-${m.id}`}
                  >
                    <div className="provider-model-main">
                      <div>
                        <span className="provider-model-name">{modelDisplayName(m, provider)}</span>
                        {m.name && m.name !== m.id && <span className="hint">{m.id}</span>}
                      </div>
                      <span className="provider-model-meta" data-testid={`provider-model-meta-${provider.id}-${m.id}`}>
                        {t('models.modelMeta', {
                          api: m.api,
                          context: m.contextWindow?.toLocaleString() ?? '—',
                          output: m.maxTokens?.toLocaleString() ?? '—',
                        })}
                        {' · '}
                        {t('models.pricing', {
                          input: formatRate(m.cost.input),
                          output: formatRate(m.cost.output),
                          cacheRead: formatRate(m.cost.cacheRead),
                          cacheWrite: formatRate(m.cost.cacheWrite),
                        })}
                      </span>
                    </div>
                    <span className="spacer" />
                    {isDefault(m.id) ? (
                      <span
                        className="provider-model-current"
                        data-testid={`current-model-${provider.id}-${m.id}`}
                      >
                        {t('models.current')}
                      </span>
                    ) : (
                      <button
                        disabled={busy}
                        data-testid={`set-current-${provider.id}-${m.id}`}
                        onClick={() => void setCurrent(m.id)}
                      >
                        {t('models.setCurrent')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
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
  const [api, setApi] = useState<string>(CUSTOM_API_TYPES[0]);
  const [apiKey, setApiKey] = useState('');
  const [modelIds, setModelIds] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxTokens, setMaxTokens] = useState('16384');
  const [contextDetected, setContextDetected] = useState(false);
  const [usePiContextDefault, setUsePiContextDefault] = useState(false);
  const [message, setMessage] = useState<string>();
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<PiProviderProbeResult>();

  const probe = async () => {
    setProbing(true);
    setMessage(undefined);
    try {
      const result = await hostApi.providers.probe({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, model: modelIds.split(',')[0]?.trim() || undefined });
      setProbeResult(result);
      if (result.models.length > 0) setModelIds(result.models.join(', '));
      const requestedModel = modelIds.split(',')[0]?.trim() || result.models[0];
      const detectedContext = result.modelDetails?.find((model) => model.id === requestedModel)?.contextWindow;
      if (detectedContext) {
        setContextWindow(String(detectedContext));
        setContextDetected(true);
        setUsePiContextDefault(false);
      } else {
        setContextDetected(false);
      }
      if (result.recommendedApi) setApi(result.recommendedApi);
      if (result.recommendedBaseUrl) setBaseUrl(result.recommendedBaseUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProbing(false);
    }
  };

  const submit = async () => {
    const models = modelIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((mid) => ({
        id: mid,
        ...(!usePiContextDefault && Number(contextWindow) > 0 ? { contextWindow: Number(contextWindow) } : {}),
        ...(Number(maxTokens) > 0 ? { maxTokens: Number(maxTokens) } : {}),
      }));
    const result = await hostApi.providers.addCustom({
      id: id.trim(),
      baseUrl: baseUrl.trim(),
      api,
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
      <input
        placeholder={t('models.customBaseUrl')}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <select
        aria-label={t('models.customApi')}
        data-testid="custom-api-select"
        value={api}
        onChange={(e) => setApi(e.target.value)}
      >
        {CUSTOM_API_TYPES.map((apiType) => (
          <option key={apiType} value={apiType}>
            {apiType}
          </option>
        ))}
      </select>
      <input
        placeholder={t('models.keyPlaceholder')}
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <button type="button" data-testid="probe-custom-provider" disabled={probing || !baseUrl.trim()} onClick={() => void probe()}>
        {probing ? t('models.probing') : t('models.probe')}
      </button>
      {probeResult && (
        <div className="probe-results" data-testid="probe-results">
          {probeResult.protocols.map((protocol) => (
            <div className="probe-result-row" key={protocol.api}>
              <span>{protocol.api}</span>
              <span className={protocol.available ? 'probe-ok' : 'probe-fail'}>{protocol.available ? t('models.probeAvailable') : t('models.probeUnavailable')}</span>
              {protocol.available && <span className={protocol.cacheStats ? 'probe-ok' : 'hint'}>{protocol.cacheStats ? t('models.probeCache') : t('models.probeNoCache')}</span>}
            </div>
          ))}
          {probeResult.modelDetails?.filter((model) => model.contextWindow).map((model) => (
            <div className="probe-result-row" data-testid="probe-model-context" key={`context-${model.id}`}>
              <span>{model.id}</span>
              <span className="probe-ok">{t('models.probeContext', { count: model.contextWindow?.toLocaleString() })}</span>
            </div>
          ))}
        </div>
      )}
      <input
        placeholder={t('models.customModels')}
        value={modelIds}
        onChange={(e) => setModelIds(e.target.value)}
      />
      <div className="form-row">
        <input
          data-testid="custom-context-window"
          disabled={usePiContextDefault}
          inputMode="numeric"
          placeholder={t('models.customContextWindow')}
          value={contextWindow}
          onChange={(e) => { setContextWindow(e.target.value.replace(/\D/g, '')); setContextDetected(false); }}
        />
        <input data-testid="custom-max-tokens" inputMode="numeric" placeholder={t('models.customMaxTokens')} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className={`model-context-status${contextDetected ? ' detected' : ''}`} data-testid="custom-context-status">
        {contextDetected
          ? t('models.contextDetected', { count: Number(contextWindow).toLocaleString() })
          : usePiContextDefault
            ? t('models.contextUsingDefault')
            : t('models.contextRequired')}
      </div>
      <label className="model-context-default">
        <input
          type="checkbox"
          data-testid="custom-use-pi-context-default"
          checked={usePiContextDefault}
          onChange={(event) => { setUsePiContextDefault(event.target.checked); if (event.target.checked) setContextDetected(false); }}
        />
        <span>{t('models.usePiContextDefault')}</span>
      </label>
      <div className="actions">
        <button className="primary" disabled={!id.trim() || !baseUrl.trim() || !modelIds.trim() || (!usePiContextDefault && !(Number(contextWindow) > 0))} onClick={() => void submit()}>
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
  const [models, setModels] = useState<PiModelRow[]>([]);
  const [defaultModel, setDefaultModel] = useState<PiDefaultModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [oauthMessages, setOauthMessages] = useState<string[]>([]);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string>();

  const refresh = () => {
    setLoading(true);
    setError(undefined);
    void hostApi.providers
      .list()
      .then((r) => setProviders(r.providers))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    void hostApi.providers.listModels().then((r) => setModels(r.models)).catch(() => {});
    void hostApi.providers.getDefaultModel().then((r) => setDefaultModel(r.model)).catch(() => {});
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

  const refreshCatalog = async () => {
    setRefreshingCatalog(true);
    setRefreshMessage(undefined);
    const result = await hostApi.providers.refresh();
    setRefreshingCatalog(false);
    setRefreshMessage(
      result.success
        ? result.discoveredModels
          ? t('models.refreshCompleteWithDiscovery', {
            count: result.discoveredModels,
            added: result.addedModels ?? 0,
          })
          : t('models.refreshComplete')
        : result.error,
    );
    refresh();
  };

  return (
    <div className="models-page">
      <div className="models-header">
        <h2>{t('models.title')}</h2>
        <button
          className="icon-button"
          data-testid="refresh-models"
          title={t('models.refresh')}
          aria-label={t('models.refresh')}
          disabled={refreshingCatalog}
          onClick={() => void refreshCatalog()}
        >
          <RefreshCw size={16} className={refreshingCatalog ? 'spin' : ''} />
        </button>
      </div>
      <input
        className="search-input"
        data-testid="models-search"
        placeholder={t('list.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {oauthMessages.length > 0 && (
        <div className="hint" data-testid="oauth-progress">
          {t('models.oauthStarted')}
        </div>
      )}
      {refreshMessage && <div className="hint" data-testid="models-refresh-message">{refreshMessage}</div>}
      {loading && (
        <p className="hint" data-testid="models-loading">
          {t('states.loading')}
        </p>
      )}
      {error && (
        <div data-testid="models-error">
          <p className="error-text">{error}</p>
          <button data-testid="models-retry" onClick={refresh}>
            {t('states.retry')}
          </button>
        </div>
      )}
      <div className="provider-list">
        {providers
          .filter(
            (p) =>
              !query ||
              p.name.toLowerCase().includes(query.toLowerCase()) ||
              p.id.toLowerCase().includes(query.toLowerCase()),
          )
          .map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            models={models.filter((m) => m.provider === p.id)}
            defaultModel={defaultModel}
            onChanged={refresh}
            onDefaultChanged={setDefaultModel}
          />
        ))}
      </div>
      <CustomProviderForm onAdded={refresh} />
    </div>
  );
}
