import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';

export interface HistoricalBranchBannerProps {
  turnNumber: number;
  onReturnToLatest: () => void;
  onOpenTree: () => void;
}

export function HistoricalBranchBanner({
  turnNumber,
  onReturnToLatest,
  onOpenTree,
}: HistoricalBranchBannerProps) {
  const { t } = useTranslation();

  return (
    <div className="historical-branch-banner" data-testid="historical-branch-banner">
      <div className="historical-branch-banner-text">
        <GitBranch size={13} className="historical-branch-icon" />
        <span>{t('chat.historicalBanner.previewing', { turn: turnNumber })}</span>
      </div>
      <div className="historical-branch-banner-actions">
        <button
          type="button"
          className="historical-branch-btn historical-branch-btn-tree"
          data-testid="historical-branch-view-tree"
          onClick={onOpenTree}
        >
          {t('chat.historicalBanner.branchMap')}
        </button>
        <button
          type="button"
          className="historical-branch-btn historical-branch-btn-latest"
          data-testid="historical-branch-return-latest"
          onClick={onReturnToLatest}
        >
          {t('chat.historicalBanner.returnToLatest')}
        </button>
      </div>
    </div>
  );
}
