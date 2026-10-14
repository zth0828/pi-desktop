// 项目信任对话框：pi resolveProjectTrusted 的 ctx.ui.select 承载。
// App 级挂载（信任确认发生在会话创建早期，不属于任何面板/会话）；
// mount 时拉 listPending 兜底，防止窗口未就绪时 request 事件丢失。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Folder, FolderCheck, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react';
import type { PiTrustRequestPayload } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { isScratchpadCwd } from '../lib/session-groups';

interface OptionMeta {
  kind: 'primary' | 'parent' | 'session' | 'distrust' | 'distrust-session' | 'default';
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tooltip?: string;
}

function useOptionMeta() {
  const { t } = useTranslation();
  return (opt: string): OptionMeta => {
    if (opt === 'Trust') {
      return {
        kind: 'primary',
        icon: <ShieldCheck size={16} />,
        title: t('trust.options.trust'),
        subtitle: t('trust.options.trustSub'),
      };
    }
    const parent = /^Trust parent folder \((.*)\)$/.exec(opt);
    if (parent) {
      const parentPath = parent[1];
      return {
        kind: 'parent',
        icon: <FolderCheck size={16} />,
        title: t('trust.options.trustParent'),
        subtitle: t('trust.options.trustParentSub', { path: parentPath }),
        tooltip: parentPath,
      };
    }
    if (opt.includes('this session only') && opt.startsWith('Trust')) {
      return {
        kind: 'session',
        icon: <Clock size={16} />,
        title: t('trust.options.trustSession'),
        subtitle: t('trust.options.trustSessionSub'),
      };
    }
    if (opt === 'Do not trust') {
      return {
        kind: 'distrust',
        icon: <ShieldX size={16} />,
        title: t('trust.options.distrust'),
        subtitle: t('trust.options.distrustSub'),
      };
    }
    if (opt === 'Do not trust (this session only)') {
      return {
        kind: 'distrust-session',
        icon: <ShieldAlert size={16} />,
        title: t('trust.options.distrustSession'),
        subtitle: t('trust.options.distrustSessionSub'),
      };
    }
    return {
      kind: 'default',
      icon: <ShieldAlert size={16} />,
      title: opt,
    };
  };
}

export function TrustDialog() {
  const { t } = useTranslation();
  const getOptionMeta = useOptionMeta();
  const [requests, setRequests] = useState<PiTrustRequestPayload[]>([]);

  useEffect(() => {
    let alive = true;
    void hostApi.piTrust.listPending()
      .then((list) => {
        if (!alive) return;
        // 渲染层前置过滤：若是内部草稿箱，静默放行免除弹窗
        const validList: PiTrustRequestPayload[] = [];
        for (const req of list) {
          if (isScratchpadCwd(req.cwd)) {
            void hostApi.piTrust.respond(req.requestId, req.options[0]);
          } else {
            validList.push(req);
          }
        }
        setRequests(validList);
      })
      .catch(() => {});

    const offRequest = onHostEvent('piTrust', 'request', (req) => {
      if (isScratchpadCwd(req.cwd)) {
        void hostApi.piTrust.respond(req.requestId, req.options[0]);
        return;
      }
      setRequests((current) => current.some((r) => r.requestId === req.requestId) ? current : [...current, req]);
    });

    const offSettled = onHostEvent('piTrust', 'settled', ({ requestId }) => {
      setRequests((current) => current.filter((r) => r.requestId !== requestId));
    });

    return () => {
      alive = false;
      offRequest();
      offSettled();
    };
  }, []);

  const req = requests[0];

  const choose = (label?: string) => {
    if (!req) return;
    setRequests((current) => current.filter((r) => r.requestId !== req.requestId));
    void hostApi.piTrust.respond(req.requestId, label);
  };

  useEffect(() => {
    if (!req) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        choose();
        return;
      }
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= req.options.length) {
        e.preventDefault();
        e.stopPropagation();
        const chosen = req.options[num - 1];
        if (chosen) choose(chosen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [req]);

  if (!req) return null;

  return (
    <div className="trust-overlay" data-testid="trust-dialog">
      <div className="trust-card">
        <div className="trust-header">
          <div className="trust-header-badge">
            <ShieldAlert size={18} className="trust-badge-icon" />
            <h3 className="trust-title">{t('trust.title')}</h3>
          </div>
          <button
            type="button"
            className="trust-close-btn"
            aria-label={t('extui.cancel')}
            title={t('extui.cancel')}
            onClick={() => choose()}
          >
            <X size={15} />
          </button>
        </div>

        <div className="trust-body">
          <div className="trust-path-card" title={req.cwd} data-testid="trust-cwd">
            <Folder size={14} className="trust-path-icon" />
            <span className="trust-path-text">{req.cwd}</span>
          </div>

          <p className="trust-description">{t('trust.description')}</p>

          <div className="trust-options">
            {req.options.map((opt, idx) => {
              const meta = getOptionMeta(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  className={`trust-option opt-${meta.kind}`}
                  data-testid="trust-option"
                  onClick={() => choose(opt)}
                >
                  <span className="trust-option-icon">{meta.icon}</span>
                  <div className="trust-option-content">
                    <span className="trust-option-label">{meta.title}</span>
                    {meta.subtitle && (
                      <span
                        className="trust-option-sub"
                        title={meta.tooltip || meta.subtitle}
                      >
                        {meta.subtitle}
                      </span>
                    )}
                  </div>
                  <span className="trust-option-shortcut">{idx + 1}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="trust-footer">
          <span className="trust-hint">{t('extui.keyboardHint')}</span>
          <button
            type="button"
            className="btn trust-cancel-btn"
            onClick={() => choose()}
          >
            {t('extui.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
