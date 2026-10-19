import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { onHostEvent } from '../lib/host-events';
import { hostApi } from '../lib/host-api';

export function CloseConfirmDialog(props?: { forceOpen?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(props?.forceOpen ?? false);
  const [action, setAction] = useState<'minimize' | 'quit'>('minimize');
  const [remember, setRemember] = useState(false);
  const isMac = typeof window !== 'undefined' && window.pidesktop?.platform === 'darwin';

  useEffect(() => {
    return onHostEvent('windows', 'closeRequested', () => {
      setOpen(true);
      // 每次重新打开弹窗时重置勾选状态
      setAction('minimize');
      setRemember(false);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === 'Enter') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'INPUT')) {
          // 允许按钮/输入框自身处理 Enter
          return;
        }
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, action, remember]);

  const handleConfirm = () => {
    setOpen(false);
    void hostApi.windows.confirmClose({ action, remember });
  };

  const handleCancel = () => {
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="close-confirm-overlay"
      data-testid="close-confirm-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="close-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
      >
        <div className="close-confirm-header">
          <h3 id="close-confirm-title" className="close-confirm-title">
            {t('closeConfirm.title')}
          </h3>
          <button
            type="button"
            className="close-confirm-close-btn"
            data-testid="close-confirm-close"
            onClick={handleCancel}
            aria-label={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="close-confirm-body">
          <p className="close-confirm-message">{t('closeConfirm.message')}</p>

          <div className="close-confirm-options">
            <label
              className={`close-confirm-option ${action === 'minimize' ? 'active' : ''}`}
              data-testid="close-confirm-option-minimize"
            >
              <input
                type="radio"
                name="close-action"
                value="minimize"
                checked={action === 'minimize'}
                onChange={() => setAction('minimize')}
              />
              <div className="close-confirm-option-content">
                <div className="close-confirm-option-title">
                  {isMac ? t('closeConfirm.minimizeMac') : t('closeConfirm.minimizeOther')}
                </div>
                <div className="close-confirm-option-desc">
                  {isMac ? t('closeConfirm.minimizeDescMac') : t('closeConfirm.minimizeDescOther')}
                </div>
              </div>
            </label>

            <label
              className={`close-confirm-option ${action === 'quit' ? 'active' : ''}`}
              data-testid="close-confirm-option-quit"
            >
              <input
                type="radio"
                name="close-action"
                value="quit"
                checked={action === 'quit'}
                onChange={() => setAction('quit')}
              />
              <div className="close-confirm-option-content">
                <div className="close-confirm-option-title">{t('closeConfirm.quit')}</div>
                <div className="close-confirm-option-desc">{t('closeConfirm.quitDesc')}</div>
              </div>
            </label>
          </div>

          <label className="close-confirm-remember" data-testid="close-confirm-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>{t('closeConfirm.remember')}</span>
          </label>
        </div>

        <div className="close-confirm-footer">
          <button
            type="button"
            className="pill"
            data-testid="close-confirm-cancel"
            onClick={handleCancel}
          >
            {t('closeConfirm.cancel')}
          </button>
          <button
            type="button"
            className="pill active"
            data-testid="close-confirm-confirm"
            onClick={handleConfirm}
          >
            {t('closeConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
