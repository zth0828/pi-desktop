// 扩展 UI 对话框：pi 扩展 ctx.ui.confirm/select/input 的渲染层承载。
// App 级挂载（扩展 UI 不一定发生在聊天上下文）；队列在 chat store，这里只取队首。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat';

export function ExtensionUiDialog() {
  const { t } = useTranslation();
  const req = useChatStore((s) => s.uiRequests[0]);
  const respondUi = useChatStore((s) => s.respondUi);
  const [text, setText] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const requestId = req?.requestId;
  const timeoutMs = req?.timeoutMs;
  // 切换请求时重置输入草稿
  useEffect(() => setText(''), [requestId]);
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
          {req.kind === 'input' && (
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
