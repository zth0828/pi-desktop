import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  PiMcpListResult,
  PiMcpScope,
  PiMcpServerConfig,
  PiMcpServerRow,
} from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { useActiveChatStore } from './Chat/chat-store-context';

type FormState = {
  originalName?: string;
  name: string;
  scope: PiMcpScope;
  type: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
  envText: string;
  lifecycle: string;
  disabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  scope: 'global',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
  envText: '',
  lifecycle: '',
  disabled: false,
};

function envToText(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function textToEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function formToConfig(form: FormState): PiMcpServerConfig {
  const config: PiMcpServerConfig = {};
  if (form.type === 'stdio') {
    config.command = form.command.trim();
    const args = form.args.trim().split(/\s+/).filter(Boolean);
    if (args.length > 0) config.args = args;
    const env = textToEnv(form.envText);
    if (env) config.env = env;
  } else {
    config.url = form.url.trim();
  }
  if (form.lifecycle) config.lifecycle = form.lifecycle;
  if (form.disabled) config.disabled = true;
  return config;
}

function rowToForm(row: PiMcpServerRow): FormState {
  return {
    originalName: row.name,
    name: row.name,
    scope: row.scope,
    type: row.config.url ? 'http' : 'stdio',
    command: row.config.command ?? '',
    args: (row.config.args ?? []).join(' '),
    url: row.config.url ?? '',
    envText: envToText(row.config.env),
    lifecycle: row.config.lifecycle ?? '',
    disabled: row.config.disabled ?? false,
  };
}

export default function McpPage() {
  const { t } = useTranslation();
  const [result, setResult] = useState<PiMcpListResult | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string>();
  // 配置改动只写 JSON，下个会话才生效；提示用户可立即重载（piRuntime.reload）
  const [pendingReload, setPendingReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const chatStarted = useActiveChatStore((s) => s.started);

  const refresh = useCallback(() => {
    hostApi.piMcp
      .list()
      .then((r) => {
        setResult(r);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    // adapter 状态快照变化 → 重拉（状态列是增强项，接不通就只显示配置）
    const unbind = onHostEvent('piMcp', 'statusChanged', () => refresh());
    return unbind;
  }, [refresh, chatStarted]);

  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await action();
      if (!r.success) setError(r.error ?? 'unknown');
      else setPendingReload(true);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reloadNow = async () => {
    setReloading(true);
    setError(undefined);
    try {
      // 重载活动 runtime（pi /reload 语义：流式中/压缩中会被 main 拒绝，错误走错误条）
      const r = await hostApi.piRuntime.reload();
      if (!r.success) {
        setError(r.error ?? 'unknown');
        return;
      }
      setPendingReload(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  };

  const saveForm = () =>
    run(async () => {
      if (!form) return { success: false, error: 'no form' };
      const r = await hostApi.piMcp.upsert({
        scope: form.scope,
        name: form.name,
        originalName: form.originalName,
        config: formToConfig(form),
      });
      if (r.success) setForm(null);
      return r;
    });

  const installAdapter = async () => {
    setInstalling(true);
    setError(undefined);
    try {
      const r = await hostApi.piMcp.installAdapter();
      if (!r.success) setError(r.error ?? 'unknown');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  const servers = result?.servers ?? [];

  return (
    <div className="mcp-page">
      <h2>{t('mcp.title')}</h2>
      <p className="hint">{t('mcp.hint')}</p>
      <input
        className="search-input"
        placeholder={t('list.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {result && !result.adapterInstalled && (
        <div className="mcp-server-form" data-testid="mcp-no-adapter">
          <p>{t('mcp.noAdapter')}</p>
          <p className="hint">
            <code>pi install npm:pi-mcp-adapter</code>
          </p>
          <div className="mcp-install-guide">
            <button
              className="primary"
              data-testid="mcp-install-adapter"
              disabled={installing}
              onClick={() => void installAdapter()}
            >
              {installing ? t('mcp.installingAdapter') : t('mcp.installAdapter')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text" data-testid="mcp-error">{error}</p>}

      {pendingReload && (
        <div className="mcp-reload-banner" data-testid="mcp-reload-banner">
          <span>{t('mcp.pendingReload')}</span>
          <button
            className="primary"
            data-testid="mcp-reload-now"
            disabled={reloading}
            onClick={() => void reloadNow()}
          >
            {reloading ? t('mcp.reloading') : t('mcp.reloadNow')}
          </button>
        </div>
      )}

      {!form && (
        <div>
          <button data-testid="mcp-add-server" onClick={() => setForm({ ...EMPTY_FORM })}>
            {t('mcp.addServer')}
          </button>
        </div>
      )}

      {form && (
        <div className="mcp-server-form" data-testid="mcp-server-form">
          <div className="form-row">
            <input
              data-testid="mcp-form-name"
              placeholder={t('mcp.form.name')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              data-testid="mcp-form-scope"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as PiMcpScope })}
            >
              <option value="global">{t('mcp.scope.global')}</option>
              <option value="project" disabled={!result?.projectPath}>
                {t('mcp.scope.project')}
              </option>
            </select>
            <select
              data-testid="mcp-form-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'stdio' | 'http' })}
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            <select
              data-testid="mcp-form-lifecycle"
              value={form.lifecycle}
              onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}
            >
              <option value="">{t('mcp.form.lifecycleDefault')}</option>
              <option value="lazy">lazy</option>
              <option value="eager">eager</option>
              <option value="keep-alive">keep-alive</option>
            </select>
          </div>
          {form.type === 'stdio' ? (
            <>
              <div className="form-row">
                <input
                  data-testid="mcp-form-command"
                  placeholder={t('mcp.form.command')}
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                />
                <input
                  data-testid="mcp-form-args"
                  placeholder={t('mcp.form.args')}
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                />
              </div>
              <textarea
                data-testid="mcp-form-env"
                placeholder={t('mcp.form.env')}
                rows={2}
                value={form.envText}
                onChange={(e) => setForm({ ...form, envText: e.target.value })}
              />
            </>
          ) : (
            <div className="form-row">
              <input
                data-testid="mcp-form-url"
                placeholder={t('mcp.form.url')}
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
          )}
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                data-testid="mcp-form-disabled"
                checked={form.disabled}
                onChange={(e) => setForm({ ...form, disabled: e.target.checked })}
              />
              {t('mcp.form.disabled')}
            </label>
            <button
              className="primary"
              data-testid="mcp-form-save"
              disabled={busy || !form.name.trim() || (form.type === 'stdio' ? !form.command.trim() : !form.url.trim())}
              onClick={() => void saveForm()}
            >
              {t('mcp.form.save')}
            </button>
            <button data-testid="mcp-form-cancel" onClick={() => setForm(null)}>
              {t('mcp.form.cancel')}
            </button>
          </div>
        </div>
      )}

      {servers.length === 0 && result && !error ? (
        <p className="hint" data-testid="mcp-empty">{t('mcp.empty')}</p>
      ) : (
        <div className="mcp-server-list">
          {servers
            .filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()))
            .map((s) => (
            <div
              className={s.config.disabled ? 'mcp-server-row disabled' : 'mcp-server-row'}
              data-testid={`mcp-server-${s.name}`}
              key={`${s.scope}:${s.name}`}
            >
              <div className="mcp-server-row-main">
                <span className="mcp-server-name">{s.name}</span>
                <span className="mcp-scope-badge">{t(`mcp.scope.${s.scope}`)}</span>
                {s.config.disabled && (
                  <span className="mcp-status-badge disabled" data-testid={`mcp-disabled-badge-${s.name}`}>
                    {t('mcp.disabled')}
                  </span>
                )}
                {s.status?.connected !== undefined && (
                  <span
                    className={s.status.connected ? 'mcp-status-badge connected' : 'mcp-status-badge'}
                    data-testid={`mcp-status-${s.name}`}
                  >
                    {s.status.connected
                      ? t('mcp.status.connected', { count: s.status.toolCount ?? 0 })
                      : t('mcp.status.disconnected')}
                  </span>
                )}
              </div>
              <p className="mcp-server-detail hint">
                {s.config.url ?? `${s.config.command ?? ''} ${(s.config.args ?? []).join(' ')}`.trim()}
              </p>
              <div className="mcp-server-actions">
                <button
                  data-testid={s.config.disabled ? `mcp-enable-${s.name}` : `mcp-disable-${s.name}`}
                  disabled={busy}
                  onClick={() =>
                    void run(() => hostApi.piMcp.setDisabled(s.scope, s.name, !s.config.disabled))
                  }
                >
                  {s.config.disabled ? t('mcp.enable') : t('mcp.disable')}
                </button>
                <button data-testid={`mcp-edit-${s.name}`} disabled={busy} onClick={() => setForm(rowToForm(s))}>
                  {t('mcp.edit')}
                </button>
                {confirmDelete === s.name ? (
                  <>
                    <button
                      className="danger-outline"
                      data-testid={`mcp-delete-confirm-${s.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await hostApi.piMcp.remove(s.scope, s.name);
                          if (r.success) setConfirmDelete(undefined);
                          return r;
                        })
                      }
                    >
                      {t('mcp.confirmDelete')}
                    </button>
                    <button onClick={() => setConfirmDelete(undefined)}>{t('mcp.form.cancel')}</button>
                  </>
                ) : (
                  <button
                    className="danger-outline"
                    data-testid={`mcp-delete-${s.name}`}
                    disabled={busy}
                    onClick={() => setConfirmDelete(s.name)}
                  >
                    {t('mcp.delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
