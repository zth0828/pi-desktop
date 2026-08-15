// 扩展 UI 对话框：pi 扩展 ctx.ui.confirm/select/input 的渲染层承载。
// 多面板 P2：对话框移入 ChatPane 内渲染（每面板渲染自己的 uiRequests 队列，取队首）；
// 通知 toast 仍在 App 级，过滤改为遍历所有 chat store 实例。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { PiExtensionUiNotification } from '@shared/host-api/contract';
import { onHostEvent } from '../lib/host-events';
import { getAllChatStores } from '../stores/chat-registry';
import { usePaneChatStore } from '../pages/Chat/chat-store-context';

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

  if (!req) return null;
  const cancel = () => void respondUi(req.requestId);

  return (
    <div className="extui-overlay" data-testid="extui-dialog" data-kind={req.kind}>
      <div className="extui-dialog">
        <div className="extui-title">{req.title}</div>
        {req.kind === 'confirm' && req.message && (
          <div className="extui-message" data-testid="extui-message">
            {req.message}
          </div>
        )}
        {req.kind === 'select' && (
          <div className="extui-options">
            {(req.options ?? []).map((opt) => (
              <button
                key={opt}
                className="extui-option"
                data-testid="extui-option"
                onClick={() => void respondUi(req.requestId, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {req.kind === 'input' && (
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
        )}
        {req.kind === 'editor' && (
          <textarea
            className="extui-editor"
            data-testid="extui-editor"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="extui-footer">
          {remaining !== null && (
            <span className="extui-countdown">{t('extui.countdown', { seconds: remaining })}</span>
          )}
          <button className="btn" data-testid="extui-cancel" onClick={cancel}>
            {t('extui.cancel')}
          </button>
          {req.kind === 'confirm' && (
            <button
              className="btn primary"
              data-testid="extui-confirm"
              onClick={() => void respondUi(req.requestId, true)}
            >
              {t('extui.confirm')}
            </button>
          )}
          {(req.kind === 'input' || req.kind === 'editor') && (
            <button
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
  return (
    <div className={`extui-toast ${notification.level}`} data-testid="extui-notification">
      <span>{notification.message}</span>
      <button title={t('extui.dismiss')} aria-label={t('extui.dismiss')} onClick={() => setNotification(null)}>
        <X size={14} />
      </button>
    </div>
  );
}
