import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Flame, Sparkles, X } from 'lucide-react';

export interface ContextWarningBarProps {
  contextPercent: number | null;
  compacting: boolean;
  onCompact: () => void;
}

export function ContextWarningBar({
  contextPercent,
  compacting,
  onCompact,
}: ContextWarningBarProps) {
  const { t } = useTranslation();
  const [dismissedTier, setDismissedTier] = useState<'warning' | 'danger' | null>(null);

  // 当占用降回 80% 以下时重置关闭状态，以便后续再次涨到 80% 时能正常预警
  useEffect(() => {
    if (contextPercent == null || contextPercent < 80) {
      setDismissedTier(null);
    }
  }, [contextPercent]);

  if (contextPercent == null || contextPercent < 80 || compacting) {
    return null;
  }

  const currentTier: 'warning' | 'danger' = contextPercent >= 90 ? 'danger' : 'warning';

  // 判定是否处于当前 tier 的已忽略状态：
  // 若在 80%~89%（warning）时关闭，但后续涨到 >=90%（danger），允许重新唤醒
  const isDismissed =
    dismissedTier === 'danger' || (dismissedTier === 'warning' && currentTier === 'warning');

  if (isDismissed) {
    return null;
  }

  const percentText = Math.round(contextPercent);

  return (
    <div
      className={`context-warning-bar ${currentTier}`}
      data-testid="context-warning-bar"
      data-tier={currentTier}
    >
      <div className="context-warning-content">
        {currentTier === 'danger' ? (
          <Flame size={14} className="context-warning-icon danger" />
        ) : (
          <AlertTriangle size={14} className="context-warning-icon warning" />
        )}
        <span className="context-warning-text">
          {currentTier === 'danger'
            ? t('chat.contextWarning.danger', { percent: percentText })
            : t('chat.contextWarning.warning', { percent: percentText })}
        </span>
      </div>
      <div className="context-warning-actions">
        <button
          type="button"
          className="context-warning-compact-btn"
          data-testid="context-warning-compact"
          onClick={onCompact}
        >
          <Sparkles size={13} />
          <span>{t('chat.contextWarning.compactButton')}</span>
        </button>
        <button
          type="button"
          className="context-warning-close-btn"
          data-testid="context-warning-close"
          aria-label={t('chat.contextWarning.dismiss')}
          title={t('chat.contextWarning.dismiss')}
          onClick={() => setDismissedTier(currentTier)}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
