// 主内容区顶部的全局错误条：消费 globalErrorsStore（侧栏会话操作失败等跨区域错误）。
// 渲染在所有 page-view 之上，任何页面（对话/模型/设置…）都能看到。
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { globalErrorsStore } from '../stores/global-errors';

export function GlobalErrorBanner() {
  const { t } = useTranslation();
  const errors = useStore(globalErrorsStore, (s) => s.errors);
  const dismiss = useStore(globalErrorsStore, (s) => s.dismiss);
  if (errors.length === 0) return null;
  return (
    <div className="global-error-stack" data-testid="global-error-stack" role="alert">
      {errors.map((error) => (
        <div key={error.id} className="global-error-item">
          <span className="global-error-text">{error.text}</span>
          <button
            type="button"
            data-testid="global-error-dismiss"
            onClick={() => dismiss(error.id)}
            aria-label={t('sessions.actionErrorDismiss')}
            title={t('sessions.actionErrorDismiss')}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
