// 扩展 UI 对话框：pi 扩展 ctx.ui.confirm/select/input 的渲染层承载。
// 对话框在 ChatPane 内渲染（吸附在输入框上方展开，提供充裕排版空间与快捷键）；
// 通知 toast 仍在 App 级，过滤改为遍历所有 chat store 实例。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import type { PiExtensionUiNotification } from '@shared/host-api/contract';
import { onHostEvent } from '../lib/host-events';
import { getAllChatStores } from '../stores/chat-registry';
import { usePaneChatStore } from '../pages/Chat/chat-store-context';
import { cleanOptionText } from './extension-ui-clean';

export { cleanOptionText };

export function ExtensionUiDialog() {
  const { t } = useTranslation();
  const req = usePaneChatStore((s) => s.uiRequests[0]);
  const respondUi = usePaneChatStore((s) => s.respondUi);
  const [text, setText] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const requestId = req?.requestId;
  const timeoutMs = req?.timeoutMs;
  // 切换请求时重置输入草稿
  useEffect(() => setText(req?.prefill ?? ''), [requestId, req?.prefill]);
  // 超时倒计时（展示用；到期由 main 侧 timer 兜底取消并发 uiCancel）
  useEffect(() => {
    if (!timeoutMs) {
      setRemaining(null);
      return;
    }
    const end = Date.now() + timeoutMs;
    setRemaining(Math.ceil(timeoutMs / 1000));
    const id = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(id);
  }, [requestId, timeoutMs]);

  useEffect(() => {
    if (!req) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void respondUi(req.requestId);
        return;
      }
      // select 模式下支持数字键 1-9 快速选择（仅当焦点不在输入框/文本框时）
      if (req.kind === 'select' && req.options && req.options.length > 0) {
        const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (targetTag === 'input' || targetTag === 'textarea') return;
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= req.options.length) {
          e.preventDefault();
          e.stopPropagation();
          const chosen = req.options[num - 1];
          if (chosen) void respondUi(req.requestId, chosen);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [req, respondUi]);

  if (!req) return null;
  const cancel = () => void respondUi(req.requestId);

  return (
    <div className="extui-dock" data-testid="extui-dialog" data-kind={req.kind}>
      <div className="extui-card">
        <div className="extui-header">
          <div className="extui-title-wrap">
            <span className="extui-badge">
              <Sparkles size={12} className="extui-badge-icon" />
              {t('extui.questionBadge')}
            </span>
            <h4 className="extui-title" title={req.title}>{req.title}</h4>
          </div>
          <div className="extui-header-actions">
            {remaining !== null && (
              <span className="extui-countdown" title={t('extui.countdown', { seconds: remaining })}>
                {t('extui.countdown', { seconds: remaining })}
              </span>
            )}
            <button
              type="button"
              className="extui-close-btn"
              title={t('extui.cancel')}
              aria-label={t('extui.cancel')}
              onClick={cancel}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {req.kind === 'confirm' && req.message && (
          <div className="extui-message" data-testid="extui-message">
            {req.message}
          </div>
        )}

        {req.kind === 'select' && (
          <div className="extui-options">
            {(req.options ?? []).map((opt, idx) => (
              <button
                key={opt}
                type="button"
                className="extui-option"
                data-testid="extui-option"
                onClick={() => void respondUi(req.requestId, opt)}
              >
                <span className="extui-option-index">{idx + 1}</span>
                <span className="extui-option-text">{cleanOptionText(opt)}</span>
              </button>
            ))}
          </div>
        )}

        {req.kind === 'input' && (
          <div className="extui-input-wrap">
            <input
              className="extui-input"
              data-testid="extui-input"
              placeholder={req.placeholder}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void respondUi(req.requestId, text);
              }}
            />
          </div>
        )}

        {req.kind === 'editor' && (
          <div className="extui-editor-wrap">
            <textarea
              className="extui-editor"
              data-testid="extui-editor"
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}

        <div className="extui-footer">
          <span className="extui-hint">
            {req.kind === 'select'
              ? t('extui.selectHint', { count: req.options?.length ?? 0 })
              : t('extui.keyboardHint')}
          </span>
          <div className="extui-footer-buttons">
            <button type="button" className="btn" data-testid="extui-cancel" onClick={cancel}>
              {t('extui.cancel')}
            </button>
            {req.kind === 'confirm' && (
              <button
                type="button"
                className="btn primary"
                data-testid="extui-confirm"
                onClick={() => void respondUi(req.requestId, true)}
              >
                {t('extui.confirm')}
              </button>
            )}
            {(req.kind === 'input' || req.kind === 'editor') && (
              <button
                type="button"
                className="btn primary"
                data-testid="extui-submit"
                onClick={() => void respondUi(req.requestId, text)}
              >
                {t('extui.ok')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExtensionUiNotifications() {
  const { t } = useTranslation();
  const [notification, setNotification] = useState<PiExtensionUiNotification | null>(null);
  useEffect(() => onHostEvent('piRuntime', 'uiNotification', (next) => {
    // 任一面板实例持有该会话（sessionId + generation 匹配）才展示
    const owned = getAllChatStores().some((store) => {
      const current = store.getState();
      return next.sessionId === current.sessionId && next.generation === current.generation;
    });
    if (!owned) return;
    setNotification(next);
    window.setTimeout(() => setNotification((current) => current === next ? null : current), 5000);
  }), []);
  if (!notification) return null;
  const text = notification.kind === 'unsupportedTui'
    ? t('extui.unsupportedTui', { feature: notification.message })
    : notification.message;
  return (
    <div className={`extui-toast ${notification.level}`} data-testid="extui-notification">
      <span data-testid="extui-notification-text">{text}</span>
      <button title={t('extui.dismiss')} aria-label={t('extui.dismiss')} onClick={() => setNotification(null)}>
        <X size={14} />
      </button>
    </div>
  );
}
