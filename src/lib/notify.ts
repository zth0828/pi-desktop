// 渲染层通知上报：只组文案并上报，档位/焦点判定与系统通知都在 main（electron/services/notify-api.ts）。
import { hostApi } from './host-api';
import i18n from './i18n';

/** agent 一次 run 结束（非重试中）：正文带最后一条 assistant 消息摘要。 */
export function reportRunCompleted(summary: string): void {
  void hostApi.notify
    .dispatch({ kind: 'runCompleted', title: i18n.t('notify.runCompleted'), body: summary })
    .catch(() => {});
}

/** 扩展 UI 桥挂起对话框请求（confirm/select/input 等待用户）。 */
export function reportUiRequest(requestTitle: string): void {
  void hostApi.notify
    .dispatch({ kind: 'uiRequest', title: i18n.t('notify.uiRequest'), body: requestTitle })
    .catch(() => {});
}
