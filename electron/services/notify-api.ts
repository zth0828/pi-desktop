// 系统通知：渲染层只上报事件（notify.dispatch），档位判定 + 焦点判定 + 弹通知都在 main。
// 焦点判定用 BrowserWindow.isFocused()（比渲染层 document.hasFocus() 可靠：
// 窗口最小化/失焦但 document 仍可能有焦点）。
import { appendFileSync } from 'node:fs';
import { BrowserWindow, Notification } from 'electron';
import type { HostSuccess, NotifyDispatchPayload } from '@shared/host-api/contract';
import { shouldNotify, type NotifyMode } from './notify-policy';
import { settingsApi } from './settings-api';

export const notifyApi = {
  dispatch: async (payload: NotifyDispatchPayload): Promise<HostSuccess> => {
    const mode = (await settingsApi.get({ key: 'notifyMode' })) as NotifyMode | undefined;
    // 扩展 UI 请求通知的独立开关（run 完成通知只看 notifyMode 档位）
    const uiRequestEnabled = payload.kind === 'uiRequest'
      ? ((await settingsApi.get({ key: 'notifyUiRequest' })) as boolean | undefined)
      : undefined;
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!shouldNotify(mode, win?.isFocused() ?? false, payload.kind, uiRequestEnabled)) {
      return { success: true };
    }

    // E2E 观测钩子：通知落盘一行 JSON（系统通知在无签名构建上不可断言）。
    const logPath = process.env.PI_DESKTOP_E2E_NOTIFY_LOG;
    if (logPath) {
      try {
        appendFileSync(logPath, `${JSON.stringify(payload)}\n`);
      } catch {
        // 日志不可写不影响通知本体
      }
    }

    try {
      const notification = new Notification({ title: payload.title, body: payload.body ?? '' });
      notification.on('click', () => {
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
        }
      });
      notification.show();
    } catch {
      // 未签名/无通知权限环境下系统通知可能不可用，静默降级
    }
    return { success: true };
  },
};
