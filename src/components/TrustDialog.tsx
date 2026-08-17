// 项目信任对话框：pi resolveProjectTrusted 的 ctx.ui.select 承载。
// App 级挂载（信任确认发生在会话创建早期，不属于任何面板/会话）；
// mount 时拉 listPending 兜底，防止窗口未就绪时 request 事件丢失。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiTrustRequestPayload } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';

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

export function TrustDialog() {
  const { t } = useTranslation();
  const optionLabel = useOptionLabel();
  const [requests, setRequests] = useState<PiTrustRequestPayload[]>([]);

  useEffect(() => {
    let alive = true;
    void hostApi.piTrust.listPending()
      .then((list) => { if (alive) setRequests(list); })
      .catch(() => {});
    const offRequest = onHostEvent('piTrust', 'request', (req) => {
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
  if (!req) return null;
  const choose = (label?: string) => {
    setRequests((current) => current.filter((r) => r.requestId !== req.requestId));
    void hostApi.piTrust.respond(req.requestId, label);
  };

  return (
    <div className="extui-overlay" data-testid="trust-dialog">
      <div className="extui-dialog">
        <div className="extui-title">{t('trust.title')}</div>
        <div className="extui-message" data-testid="trust-cwd">{req.cwd}</div>
        <div className="extui-message">{t('trust.description')}</div>
        <div className="extui-options">
          {req.options.map((opt) => (
            <button
              key={opt}
              className="extui-option"
              data-testid="trust-option"
              onClick={() => choose(opt)}
            >
              {optionLabel(opt)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
