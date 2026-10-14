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

/** pi getProjectTrustOptions 的英文 label → 本地化文案；结构变化时回退原文。 */
function useOptionLabel() {
  const { t } = useTranslation();
  return (label: string): string => {
    if (label === 'Trust') return t('trust.options.trust');
    const parent = /^Trust parent folder \((.*)\)$/.exec(label);
    if (parent) return t('trust.options.trustParent', { path: parent[1] });
    if (label === 'Trust (this session only)') return t('trust.options.trustSession');
    if (label === 'Do not trust') return t('trust.options.distrust');
    if (label === 'Do not trust (this session only)') return t('trust.options.distrustSession');
    return label;
  };
}

function getOptionMeta(opt: string) {
  if (opt === 'Trust') {
    return { kind: 'primary', icon: <ShieldCheck size={16} /> };
  }
  if (opt.startsWith('Trust parent folder')) {
    return { kind: 'parent', icon: <FolderCheck size={16} /> };
  }
  if (opt.includes('this session only') && opt.startsWith('Trust')) {
    return { kind: 'session', icon: <Clock size={16} /> };
  }
  if (opt.startsWith('Do not trust')) {
    return { kind: 'danger', icon: <ShieldX size={16} /> };
  }
  return { kind: 'default', icon: <ShieldAlert size={16} /> };
}

export function TrustDialog() {
  const { t } = useTranslation();
  const optionLabel = useOptionLabel();
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
                  className={`trust-option ${meta.kind}`}
                  data-testid="trust-option"
                  onClick={() => choose(opt)}
                >
                  <span className="trust-option-icon">{meta.icon}</span>
                  <div className="trust-option-content">
                    <span className="trust-option-label">{optionLabel(opt)}</span>
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
