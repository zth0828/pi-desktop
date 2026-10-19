import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Radar, RefreshCw, X } from 'lucide-react';
import type { PiDefaultModel, PiModelRow, PiProviderProbeResult, PiProviderRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { getActiveChatStore } from '../stores/chat-registry';
import { navigateToPage } from '../lib/app-navigation';
import { usePiSystemStore } from '../stores/pi-system';

const CUSTOM_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;

const API_REQUEST_SUFFIX: Record<(typeof CUSTOM_API_TYPES)[number], string> = {
  'openai-completions': '/chat/completions',
  'openai-responses': '/responses',
  'anthropic-messages': '/v1/messages',
  'google-generative-ai': '/models/{model}:generateContent',
};

function requestUrlForApi(baseUrl: string, api: string): string | undefined {
  if (!Object.hasOwn(API_REQUEST_SUFFIX, api)) return undefined;
  const normalizedBase = api === 'anthropic-messages'
    ? baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')
    : baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}${API_REQUEST_SUFFIX[api as keyof typeof API_REQUEST_SUFFIX]}`;
}

function requestUrlForProvider(baseUrl: string, models: PiModelRow[]): string | undefined {
  const apiTypes = [...new Set(models.map((model) => model.api))];
  return apiTypes.length === 1 ? requestUrlForApi(baseUrl, apiTypes[0]) : undefined;
}

type ProviderRowProps = {
  provider: PiProviderRow;
  /** 该供应商已配置凭证后的可用模型（providers.listModels 按 provider 分组）。 */
  models: PiModelRow[];
  defaultModel: PiDefaultModel | null;
  onChanged: () => void;
  onDefaultChanged: (model: PiDefaultModel) => void;
  currentPiVersion?: string;
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

function formatRate(rate: number | undefined): string {
  // 未上报价格 → 占位；真 0（如免费/本地模型）仍显示 $0
  if (rate === undefined || rate === null) return '—';
  return rate === 0 ? '$0' : `$${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

/** 供应商 id 由名称生成 slug（保留 Unicode 字母数字，中文名称可用）。 */
function slugifyProviderName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'custom-provider';
}

function uniqueProviderId(name: string, existingIds: string[]): string {
  const base = slugifyProviderName(name);
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function ProviderRow({ provider, models, defaultModel, onChanged, onDefaultChanged, currentPiVersion }: ProviderRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApi, setEditApi] = useState('openai-responses');

  useEffect(() => {
    if (!editing) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setEditing(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [editing]);

  const startEdit = () => {
    setEditName(provider.name);
    setEditBaseUrl(provider.baseUrl ?? '');
    setEditApi(provider.api ?? models[0]?.api ?? 'openai-responses');
    setEditing(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.updateCustom({
      providerId: provider.id,
      name: editName.trim(),
      baseUrl: editBaseUrl.trim(),
      api: editApi,
    });
    setBusy(false);
    if (result.success) {
      setEditing(false);
      onChanged();
    } else {
      setMessage(result.error);
    }
  };
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
    if (result.success) onChanged();
    else setMessage(result.error);
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
        getActiveChatStore()?.getState().applyModelUpdate({
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

  const syncRuntimeReasoning = (modelId: string, reasoning: boolean) => {
    const activeStore = getActiveChatStore();
    const runtime = activeStore?.getState();
    if (!activeStore || !runtime?.model || runtime.model.provider !== provider.id || runtime.model.id !== modelId) return;
    const levels = runtime.availableThinkingLevels.length > 0
      ? runtime.availableThinkingLevels
      : reasoning ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : [];
    activeStore.getState().applyModelUpdate({

      success: true,
      model: { ...runtime.model, reasoning },
      thinkingLevel: runtime.thinkingLevel,
      availableThinkingLevels: levels,
      contextUsage: runtime.contextUsage ?? undefined,
    });
  };

  const setReasoning = async (modelId: string, reasoning: boolean) => {
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.setModelReasoning(provider.id, modelId, reasoning);
    setBusy(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    onChanged();
    syncRuntimeReasoning(modelId, reasoning);
    // 若活动会话正在使用该模型，同步会话状态，思考深度菜单立即恢复可用
  };

  // 图像开关与推理开关同构：活动会话正在使用该模型时同步 input 声明，
  // 图片附件能力即时生效。
  const syncRuntimeInput = (modelId: string, image: boolean) => {
    const activeStore = getActiveChatStore();
    const runtime = activeStore?.getState();
    if (!activeStore || !runtime?.model || runtime.model.provider !== provider.id || runtime.model.id !== modelId) return;
    activeStore.getState().applyModelUpdate({
      success: true,
      model: { ...runtime.model, input: image ? ['text', 'image'] : ['text'] },
      thinkingLevel: runtime.thinkingLevel,
      availableThinkingLevels: runtime.availableThinkingLevels,
      contextUsage: runtime.contextUsage ?? undefined,
    });
  };

  const setImage = async (modelId: string, image: boolean) => {
    setBusy(true);
    setMessage(undefined);
    const result = await hostApi.providers.setModelInput(provider.id, modelId, image);
    setBusy(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    onChanged();
    syncRuntimeInput(modelId, image);
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
        <span className="provider-source" data-testid={`catalog-source-${provider.id}`}>
          {t(`models.catalogSource.${provider.catalogSource ?? provider.source}`)}
        </span>
        {provider.lastRefreshedAt && (
          <span className="hint" data-testid={`provider-refreshed-${provider.id}`}>
            {t('models.lastRefreshed', { time: new Date(provider.lastRefreshedAt).toLocaleTimeString() })}
          </span>
        )}
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
          {provider.catalogSource === 'builtin-static' && (
            <div className="provider-catalog-notice" data-testid={`catalog-notice-${provider.id}`}>
              <span>{t('models.builtinStaticNotice', { version: currentPiVersion ?? '?' })}</span>
              <button
                type="button"
                className="pill"
                data-testid={`upgrade-pi-link-${provider.id}`}
                onClick={() => navigateToPage('settings', 'settings-pi-status')}
              >
                {t('models.upgradePiAction')}
              </button>
            </div>
          )}
          {provider.baseUrl && (
            <div className="provider-endpoints">
              <div className="provider-base-url" data-testid={`provider-base-url-${provider.id}`}>
                {provider.baseUrl}
              </div>
              {requestUrlForProvider(provider.baseUrl, models) && (
                <div className="provider-request-url" data-testid={`provider-request-url-${provider.id}`}>
                  {t('models.actualRequest', { url: requestUrlForProvider(provider.baseUrl, models) })}
                </div>
              )}
            </div>
          )}
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
              className="outline"
              data-testid={`edit-provider-${provider.id}`}
              disabled={busy}
              onClick={startEdit}
            >
              {t('models.editProvider')}
            </button>
          )}
          {provider.source === 'config' && editing && createPortal(
            <div
              className="provider-modal-overlay"
              data-testid={`provider-edit-overlay-${provider.id}`}
            >
              <div
                className="provider-modal-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`edit-provider-title-${provider.id}`}
                data-testid={`provider-edit-form-${provider.id}`}
              >
                <div className="provider-modal-header">
                  <div className="provider-modal-title-group">
                    <h3 id={`edit-provider-title-${provider.id}`} className="provider-modal-title">{t('models.editProviderTitle')}</h3>
                    <p className="provider-modal-desc">{t('models.editProviderDesc')}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button provider-modal-close"
                    onClick={() => setEditing(false)}
                    aria-label={t('models.closeDialog')}
                    title={t('models.closeDialog')}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="provider-modal-body">
                  <div className="provider-field">
                    <label htmlFor={`edit-name-${provider.id}`}>{t('models.fieldName')}</label>
                    <input
                      id={`edit-name-${provider.id}`}
                      data-testid={`edit-name-${provider.id}`}
                      placeholder={t('models.customName')}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <div className="provider-field-hint">{t('models.fieldNameHint')}</div>
                  </div>
                  <div className="provider-field">
                    <label htmlFor={`edit-base-url-${provider.id}`}>{t('models.fieldBaseUrl')}</label>
                    <input
                      id={`edit-base-url-${provider.id}`}
                      data-testid={`edit-base-url-${provider.id}`}
                      placeholder={t('models.customBaseUrl')}
                      value={editBaseUrl}
                      onChange={(e) => setEditBaseUrl(e.target.value)}
                    />
                    <div className="provider-field-hint">{t('models.fieldBaseUrlHint')}</div>
                    {requestUrlForApi(editBaseUrl, editApi) && (
                      <div className="provider-request-url" data-testid={`edit-request-url-${provider.id}`}>
                        {t('models.actualRequest', { url: requestUrlForApi(editBaseUrl, editApi) })}
                      </div>
                    )}
                  </div>
                  <div className="provider-field">
                    <label htmlFor={`edit-api-${provider.id}`}>{t('models.fieldApi')}</label>
                    <select
                      id={`edit-api-${provider.id}`}
                      aria-label={t('models.customApi')}
                      data-testid={`edit-api-${provider.id}`}
                      value={editApi}
                      onChange={(e) => setEditApi(e.target.value)}
                    >
                      {CUSTOM_API_TYPES.map((apiType) => (
                        <option key={apiType} value={apiType}>{apiType}</option>
                      ))}
                    </select>
                    <div
                      className="provider-field-hint"
                      data-testid={`edit-api-hint-${provider.id}`}
                    >
                      {t(`models.apiHint.${editApi}`)}
                    </div>
                  </div>
                  {message && <p className="error-text">{message}</p>}
                </div>
                <div className="provider-modal-actions">
                  <button type="button" disabled={busy} onClick={() => setEditing(false)}>
                    {t('models.cancel')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !editName.trim() || !editBaseUrl.trim()}
                    onClick={() => void saveEdit()}
                  >
                    {t('models.saveEdit')}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
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
                models.map((m) => {
                  const contextText = t('models.metaContext', {
                    context: m.contextWindow?.toLocaleString() ?? '—',
                  });
                  const outputText = t('models.metaOutput', {
                    output: m.maxTokens?.toLocaleString() ?? '—',
                  });
                  const pricingText = t('models.pricing', {
                    input: formatRate(m.cost?.input),
                    output: formatRate(m.cost?.output),
                    cacheRead: formatRate(m.cost?.cacheRead),
                    cacheWrite: formatRate(m.cost?.cacheWrite),
                  });
                  const metaTitle = [
                    m.input?.includes('image') ? t('models.visionMeta') : '',
                    m.api ?? '',
                    contextText,
                    outputText,
                    pricingText,
                  ].filter(Boolean).join(' · ');
                  return (
                  <div
                    className="provider-model-row"
                    key={m.id}
                    data-testid={`provider-model-${provider.id}-${m.id}`}
                  >
                    <div className="provider-model-main">
                      {/* 行1：名称 + ID（超长 ellipsis，title 悬浮全文）+ 视觉徽标 */}
                      <div className="provider-model-title">
                        <span
                          className="provider-model-name"
                          title={modelDisplayName(m, provider)}
                        >
                          {modelDisplayName(m, provider)}
                        </span>
                        {m.name && m.name !== m.id && (
                          <span className="provider-model-id hint" title={m.id}>{m.id}</span>
                        )}
                        {m.input?.includes('image') && (
                          <span
                            className="provider-model-vision"
                            data-testid={`provider-model-vision-${provider.id}-${m.id}`}
                          >
                            {t('models.visionMeta')}
                          </span>
                        )}
                      </div>
                      {/* 行2：协议 · 上下文 · 最大输出；行3：价格。meta 容器 testid 供 E2E 断言 */}
                      <span
                        className="provider-model-meta"
                        title={metaTitle}
                        data-testid={`provider-model-meta-${provider.id}-${m.id}`}
                      >
                        <span className="provider-model-specs">
                          <span className="provider-model-meta-chunk">{m.api}</span>
                          <span className="provider-model-meta-chunk">{contextText}</span>
                          <span
                            className="provider-model-meta-chunk"
                            data-testid={`provider-model-meta-output-${provider.id}-${m.id}`}
                          >
                            {outputText}
                          </span>
                        </span>
                        <span
                          className="provider-model-pricing"
                          data-testid={`provider-model-pricing-${provider.id}-${m.id}`}
                        >
                          {pricingText}
                        </span>
                      </span>
                    </div>
                    {/* 右侧固定列：标签胶囊组在上、当前徽标/按钮在下，不与左侧元数据互挤 */}
                    <div className="provider-model-side">
                      {provider.source === 'config' && (
                        <div className="provider-model-badges">
                          <label
                            className="provider-model-pill"
                            data-testid={`provider-model-reasoning-${provider.id}-${m.id}`}
                            title={t('models.reasoningHint')}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(m.reasoning)}
                              disabled={busy}
                              onChange={(e) => void setReasoning(m.id, e.target.checked)}
                            />
                            <span>{t('models.reasoningSupport')}</span>
                          </label>
                          <label
                            className="provider-model-pill"
                            data-testid={`provider-model-image-${provider.id}-${m.id}`}
                            title={t('models.imageSupportHint')}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(m.input?.includes('image'))}
                              disabled={busy}
                              onChange={(e) => void setImage(m.id, e.target.checked)}
                            />
                            <span>{t('models.imageSupport')}</span>
                          </label>
                        </div>
                      )}
                      {isDefault(m.id) ? (
                        <span
                          className="provider-model-pill provider-model-current"
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
                  </div>
                  );
                })
              )}
            </div>
          )}
          {message && <p className="error-text">{message}</p>}
        </div>
      )}
    </div>
  );
}

function CustomProviderForm({ onAdded, existingProviderIds }: { onAdded: () => void; existingProviderIds: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState<string>('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [modelIds, setModelIds] = useState('');
  const [message, setMessage] = useState<string>();
  const [probing, setProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [probeResult, setProbeResult] = useState<PiProviderProbeResult>();

  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [pendingApiSwitch, setPendingApiSwitch] = useState<string | null>(null);

  const probeGenRef = useRef(0);
  const dialogRef = useRef<HTMLFormElement>(null);
  const subdialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  const isDirty = Boolean(name.trim() || baseUrl.trim() || apiKey.trim() || probeResult);
  const canSubmit = Boolean(probeResult && name.trim() && baseUrl.trim() && modelIds.trim());

  const resetForm = () => {
    probeGenRef.current += 1;
    setName('');
    setBaseUrl('');
    setApi('openai-completions');
    setApiKey('');
    setModelIds('');
    setMessage(undefined);
    setProbeResult(undefined);
    setProbing(false);
    setSubmitting(false);
    setConfirmDiscardOpen(false);
    setPendingApiSwitch(null);
  };

  const closeDialog = () => {
    resetForm();
    setOpen(false);
    (triggerRef.current ?? triggerButtonRef.current)?.focus();
  };

  const requestClose = () => {
    if (submitting) return;
    if (isDirty) {
      setConfirmDiscardOpen(true);
    } else {
      closeDialog();
    }
  };

  const openForm = () => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerButtonRef.current;
    resetForm();
    setOpen(true);
  };

  const resetProbe = () => {
    probeGenRef.current += 1;
    setProbing(false);
    setProbeResult(undefined);
    setModelIds('');
    setApi('openai-completions');
  };

  const selectApi = (nextApi: string) => {
    if (nextApi === api) return;
    if (probeResult) {
      setPendingApiSwitch(nextApi);
    } else {
      setApi(nextApi);
    }
  };

  const confirmSwitchApi = () => {
    if (!pendingApiSwitch) return;
    const nextApi = pendingApiSwitch;
    setApi(nextApi);
    const protocol = probeResult?.protocols.find((candidate) => candidate.api === nextApi);
    if (protocol?.resolvedBaseUrl) setBaseUrl(protocol.resolvedBaseUrl);
    setPendingApiSwitch(null);
  };

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameInputRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (confirmDiscardOpen || pendingApiSwitch !== null) {
      subdialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    }
  }, [confirmDiscardOpen, pendingApiSwitch]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        if (confirmDiscardOpen) {
          setConfirmDiscardOpen(false);
        } else if (pendingApiSwitch !== null) {
          setPendingApiSwitch(null);
        } else {
          requestClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        const isSubdialog = confirmDiscardOpen || pendingApiSwitch !== null;
        const container = isSubdialog ? subdialogRef.current : dialogRef.current;
        if (!container) return;
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !container.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !container.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, confirmDiscardOpen, pendingApiSwitch, isDirty, submitting]);

  const probe = async () => {
    const gen = ++probeGenRef.current;
    setProbing(true);
    setMessage(undefined);
    try {
      const result = await hostApi.providers.probe({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        model: modelIds.split(',')[0]?.trim() || undefined,
      });
      if (gen !== probeGenRef.current) return;
      setProbeResult(result);
      if (result.models.length > 0) setModelIds(result.models.join(', '));
      if (result.recommendedApi) setApi(result.recommendedApi);
      if (result.recommendedBaseUrl) setBaseUrl(result.recommendedBaseUrl);
    } catch (error) {
      if (gen !== probeGenRef.current) return;
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (gen === probeGenRef.current) {
        setProbing(false);
      }
    }
  };

  const verifyProtocols = async () => {
    const gen = ++probeGenRef.current;
    setProbing(true);
    setMessage(undefined);
    try {
      const result = await hostApi.providers.probe({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        model: modelIds.split(',')[0]?.trim() || undefined,
        verifyProtocols: true,
      });
      if (gen !== probeGenRef.current) return;
      setProbeResult(result);
      if (result.recommendedApi) setApi(result.recommendedApi);
      if (result.recommendedBaseUrl) setBaseUrl(result.recommendedBaseUrl);
    } catch (error) {
      if (gen !== probeGenRef.current) return;
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (gen === probeGenRef.current) {
        setProbing(false);
      }
    }
  };

  const submit = async () => {
    if (submitting || probing || !canSubmit) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const detectedDetails = new Map(
        (probeResult?.modelDetails ?? []).map((model) => [model.id, model]),
      );
      const models = modelIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((mid) => {
          const detail = detectedDetails.get(mid);
          return {
            id: mid,
            ...(detail?.contextWindow && detail.contextWindow > 0 ? { contextWindow: detail.contextWindow } : {}),
            ...(detail?.maxTokens ? { maxTokens: detail.maxTokens } : {}),
            ...(detail?.input ? { input: detail.input } : {}),
            ...(detail?.thinkingLevelMap ? { thinkingLevelMap: detail.thinkingLevelMap } : {}),
          };
        });
      const result = await hostApi.providers.addCustom({
        id: uniqueProviderId(name, existingProviderIds),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        api,
        apiKey: apiKey.trim() || undefined,
        serverType: probeResult?.serverType,
        models,
      });
      if (result.success) {
        closeDialog();
        onAdded();
      } else {
        setMessage(result.error);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button ref={triggerButtonRef} data-testid="add-custom-provider" onClick={openForm}>
        {t('models.addCustom')}
      </button>
      {open && createPortal(
        <div
          className="provider-modal-overlay"
          data-testid="custom-provider-overlay"
        >
      <form
        ref={dialogRef}
        className="provider-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-provider-title"
        data-testid="custom-provider-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="provider-modal-header">
          <div className="provider-modal-title-group">
            <h3 id="custom-provider-title" className="provider-modal-title">{t('models.addCustomTitle')}</h3>
            <p className="provider-modal-desc">{t('models.addCustomDesc')}</p>
          </div>
          <button
            type="button"
            className="icon-button provider-modal-close"
            onClick={requestClose}
            aria-label={t('models.closeDialog')}
            title={t('models.closeDialog')}
            disabled={submitting}
          >
            <X size={16} />
          </button>
        </div>
        <div className="provider-modal-body">
          <div className="provider-field">
            <label htmlFor="custom-provider-name">{t('models.fieldName')}</label>
            <input
              ref={nameInputRef}
              id="custom-provider-name"
              data-testid="custom-provider-name"
              placeholder={t('models.customName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
            <div className="provider-field-hint">{t('models.fieldNameHint')}</div>
          </div>
          <div className="provider-field">
            <label htmlFor="custom-provider-base-url">{t('models.fieldBaseUrl')}</label>
            <input
              id="custom-provider-base-url"
              placeholder={t('models.customBaseUrl')}
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                resetProbe();
              }}
              disabled={submitting}
            />
            <div className="provider-field-hint">{t('models.fieldBaseUrlHint')}</div>
          </div>
          <div className="provider-field">
            <label htmlFor="custom-provider-key">{t('models.fieldApiKey')}</label>
            <input
              id="custom-provider-key"
              placeholder={t('models.keyPlaceholder')}
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                resetProbe();
              }}
              disabled={submitting}
            />
            <div className="provider-field-hint">{t('models.fieldApiKeyHint')}</div>
          </div>
          <div className="provider-form-section">
            <div className="provider-section-header">
              <div className="provider-section-title">{t('models.probeSectionTitle')}</div>
              <div className="provider-section-desc">{t('models.probeSectionDesc')}</div>
            </div>
            <div className="probe-actions">
              <button
                type="button"
                className="primary probe-button"
                data-testid="probe-custom-provider"
                disabled={probing || submitting || !baseUrl.trim()}
                onClick={() => void probe()}
              >
                <Radar size={15} />
                {probing ? t('models.probing') : t('models.probe')}
              </button>
              <button
                type="button"
                className="outline probe-button"
                data-testid="verify-protocols"
                title={t('models.verifyProtocolHint')}
                disabled={probing || submitting || !probeResult || !baseUrl.trim()}
                onClick={() => void verifyProtocols()}
              >
                <Radar size={15} />
                {probing ? t('models.probing') : t('models.verifyProtocol')}
              </button>
            </div>
            <p className="hint" data-testid="probe-list-hint">{t('models.probeListHint')}</p>
            {probeResult && (
              <div className="probe-results" data-testid="probe-results">
                {probeResult.models.length === 0 && probeResult.catalogError && (
                  <p className="error-text" data-testid="probe-catalog-error">
                    {t('models.probeCatalogFailed', { error: probeResult.catalogError })}
                  </p>
                )}
                {probeResult.protocols.length > 0
                  && probeResult.protocols.every((protocol) => protocol.verified && !protocol.available) && (
                  <p className="probe-rejected-hint" data-testid="probe-rejected-hint">
                    {t('models.probeRejectedHint')}
                  </p>
                )}
                {probeResult.protocols.map((protocol) => (
                  <div className="probe-result-row" key={protocol.api}>
                    <span className="probe-protocol-name">{protocol.api}</span>
                    <span className="probe-status-slot">
                      {protocol.verified ? (
                        <span className={protocol.available ? 'probe-ok' : 'probe-fail'}>
                          {protocol.available ? t('models.probeAvailable') : t('models.probeUnavailable')}
                        </span>
                      ) : protocol.available ? (
                        <span className="probe-ok">{t('models.probeAdvertised')}</span>
                      ) : (
                        <span className="hint">{t('models.probeUnverified')}</span>
                      )}
                    </span>
                    <span className="probe-cache-slot">
                      {protocol.verified && protocol.available ? (
                        <span className={protocol.cacheStats ? 'probe-ok' : 'hint'}>
                          {protocol.cacheStats ? t('models.probeCache') : t('models.probeNoCache')}
                        </span>
                      ) : null}
                    </span>
                    {protocol.verified && protocol.error && (
                      <span className="probe-error" data-testid={`probe-error-${protocol.api}`}>{protocol.error}</span>
                    )}
                  </div>
                ))}
                <div className="probe-api-choice">
                  <label htmlFor="custom-api-select">
                    {probeResult.protocols.some((protocol) => protocol.verified && protocol.available)
                      ? t('models.detectedApi')
                      : t('models.unverifiedApi')}
                  </label>
                  <select
                    id="custom-api-select"
                    aria-label={t('models.customApi')}
                    data-testid="custom-api-select"
                    value={api}
                    onChange={(event) => selectApi(event.target.value)}
                    disabled={submitting}
                  >
                    {CUSTOM_API_TYPES.map((apiType) => (
                      <option key={apiType} value={apiType}>{apiType}</option>
                    ))}
                  </select>
                  <div className="provider-field-hint" data-testid="custom-api-hint">
                    {t(`models.apiHint.${api}`)}
                  </div>
                  {requestUrlForApi(baseUrl, api) && (
                    <span className="probe-request-url" data-testid="custom-request-url">
                      {t('models.actualRequest', { url: requestUrlForApi(baseUrl, api) })}
                    </span>
                  )}
                </div>
                {probeResult.models.length > 0 && (
                  <details className="probe-models-fold" data-testid="probe-models" open>
                    <summary className="probe-models-title">
                      {t('models.probeModels', { count: probeResult.models.length })}
                    </summary>
                    <div className="probe-models">
                      {probeResult.models.map((modelId) => {
                        const detail = probeResult.modelDetails?.find((model) => model.id === modelId);
                        const selected = modelIds.split(',').map((id) => id.trim()).includes(modelId);
                        return (
                          <label className="probe-model-row" data-testid={`probe-model-${modelId}`} key={modelId}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => {
                                const ids = modelIds.split(',').map((id) => id.trim()).filter(Boolean);
                                const next = event.target.checked
                                  ? [...new Set([...ids, modelId])]
                                  : ids.filter((id) => id !== modelId);
                                setModelIds(next.join(', '));
                              }}
                              disabled={submitting}
                            />
                            <span className="probe-model-id" title={modelId}>{modelId}</span>
                            <span className="probe-model-vision-slot">
                              {detail?.input?.includes('image') && (
                                <span className="provider-model-vision" data-testid={`probe-model-vision-${modelId}`}>
                                  {t('models.imageSupport')}
                                </span>
                              )}
                            </span>
                            <span className="probe-model-spec" data-testid={`probe-model-spec-${modelId}`}>
                              {t('models.probeSpec', {
                                contextWindow: detail?.contextWindow?.toLocaleString() ?? '—',
                                maxOutput: detail?.maxTokens?.toLocaleString() ?? '—',
                              })}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
          {probeResult && probeResult.models.length === 0 && (
            <div className="provider-field">
              <label htmlFor="custom-models">{t('models.fieldModels')}</label>
              <input
                id="custom-models"
                data-testid="custom-models"
                placeholder={t('models.customModels')}
                value={modelIds}
                onChange={(e) => setModelIds(e.target.value)}
                disabled={submitting}
              />
              <div className="provider-field-hint">{t('models.fieldModelsHint')}</div>
            </div>
          )}
          {message && <p className="error-text">{message}</p>}
        </div>
        <div className="provider-modal-actions">
          <button type="button" disabled={submitting} onClick={requestClose}>{t('models.cancel')}</button>
          <button
            type="submit"
            className="primary"
            disabled={!canSubmit || submitting || probing}
          >
            {submitting ? t('models.savingCustom') : t('models.saveCustom')}
          </button>
        </div>
      </form>

      {confirmDiscardOpen && (
        <div
          ref={subdialogRef}
          className="provider-subdialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-confirm-title"
          data-testid="discard-confirm-dialog"
        >
          <div className="provider-subdialog-card">
            <h4 id="discard-confirm-title" className="provider-subdialog-title">{t('models.discardConfirmTitle')}</h4>
            <p className="provider-subdialog-desc">{t('models.discardConfirmDesc')}</p>
            <div className="provider-subdialog-actions">
              <button
                type="button"
                data-testid="discard-cancel-button"
                onClick={() => setConfirmDiscardOpen(false)}
              >
                {t('models.discardContinueEditing')}
              </button>
              <button
                type="button"
                className="outline"
                data-testid="discard-confirm-button"
                onClick={closeDialog}
              >
                {t('models.discardConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingApiSwitch && (
        <div
          ref={subdialogRef}
          className="provider-subdialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="switch-api-title"
          data-testid="switch-api-dialog"
        >
          <div className="provider-subdialog-card">
            <h4 id="switch-api-title" className="provider-subdialog-title">{t('models.switchApiTitle')}</h4>
            <p className="provider-subdialog-desc">{t('models.switchApiConfirm', { api: pendingApiSwitch })}</p>
            <div className="provider-subdialog-actions">
              <button
                type="button"
                data-testid="switch-api-cancel"
                onClick={() => setPendingApiSwitch(null)}
              >
                {t('models.cancel')}
              </button>
              <button
                type="button"
                className="primary"
                data-testid="switch-api-confirm"
                onClick={confirmSwitchApi}
              >
                {t('models.switchApiButton')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>,
      document.body,
    )}
  </>
);
}

export default function ModelsPage() {
  const { t } = useTranslation();
  const currentPiVersion = usePiSystemStore((s) => s.env?.pi.version);
  const [providers, setProviders] = useState<PiProviderRow[]>([]);
  const [models, setModels] = useState<PiModelRow[]>([]);
  const [defaultModel, setDefaultModel] = useState<PiDefaultModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [oauthMessages, setOauthMessages] = useState<string[]>([]);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string>();
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | undefined>();

  const refresh = () => {
    setLoading(true);
    setError(undefined);
    void hostApi.providers
      .list()
      .then((r) => {
        setProviders(r.providers);
        setLastRefreshedAt(r.lastRefreshedAt);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    void hostApi.providers.listModels().then((r) => setModels(r.models)).catch(() => {});
    void hostApi.providers.getDefaultModel().then((r) => setDefaultModel(r.model)).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const unbindRefresh = onHostEvent('providers', 'catalogRefreshed', (payload) => {
      setLastRefreshedAt(payload.lastRefreshedAt);
      refresh();
    });
    const unbindOauth = onHostEvent('providers', 'oauthProgress', ({ event }) => {
      const url = (event as { url?: string }).url;
      if (url) {
        setOauthMessages((prev) => [...prev, url]);
        void hostApi.shell.openExternal(url);
      }
    });
    return () => {
      unbindRefresh();
      unbindOauth();
    };
  }, []);

  const refreshCatalog = async () => {
    setRefreshingCatalog(true);
    setRefreshMessage(undefined);
    const result = await hostApi.providers.refresh();
    setRefreshingCatalog(false);
    if (result.success) {
      const summary = result.discoveredModels
        ? t('models.refreshCompleteWithDiscovery', {
          count: result.discoveredModels,
          added: result.addedModels ?? 0,
        })
        : t('models.refreshComplete');
      setRefreshMessage(result.migratedProviders
        ? `${summary} ${t('models.refreshMigratedProviders', { count: result.migratedProviders })}`
        : summary);
    } else {
      setRefreshMessage(result.error);
    }
    refresh();
  };

  return (
    <div className="models-page">
      <div className="models-header">
        <div className="models-header-title-group">
          <h2>{t('models.title')}</h2>
          {lastRefreshedAt && (
            <span className="hint" data-testid="models-last-refreshed">
              {t('models.lastRefreshedAt', { time: new Date(lastRefreshedAt).toLocaleTimeString() })}
            </span>
          )}
        </div>
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
            currentPiVersion={currentPiVersion}
            onChanged={refresh}
            onDefaultChanged={setDefaultModel}
          />
        ))}
      </div>
      <CustomProviderForm onAdded={refresh} existingProviderIds={providers.map((p) => p.id)} />
    </div>
  );
}
