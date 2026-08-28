import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { PiCommandRow } from '@shared/host-api/contract';

export interface ChatInputSlashPopupProps {
  panelOpen: boolean;
  commandPanelRef: RefObject<HTMLDivElement | null>;
  matches: PiCommandRow[];
  selected: number;
  onPick: (cmd: PiCommandRow) => void;
  commandDescription: (cmd: PiCommandRow) => string;
  onClose: () => void;
}

export function ChatInputSlashPopup({
  panelOpen,
  commandPanelRef,
  matches,
  selected,
  onPick,
  commandDescription,
  onClose,
}: ChatInputSlashPopupProps) {
  const { t } = useTranslation();
  if (!panelOpen) return null;

  return (
    <div ref={commandPanelRef} className="command-panel" data-testid="command-panel">
      <div className="command-panel-body">
        {matches.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            className={i === selected ? 'command-item selected' : 'command-item'}
            data-testid={`command-${cmd.name}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(cmd);
            }}
          >
            <span className="command-name">/{cmd.name}</span>
            <span className="command-desc">{commandDescription(cmd)}</span>
            <span className="command-source">{cmd.source}</span>
          </button>
        ))}
      </div>
      <div className="command-panel-footer" data-testid="command-panel-footer">
        <span className="command-panel-footer-hint">
          {t('chat.mentionsHint.command')}
        </span>
        <button
          type="button"
          className="command-panel-footer-close"
          data-testid="command-panel-close"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
