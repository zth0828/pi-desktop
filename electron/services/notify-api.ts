// 系统通知：渲染层只上报事件（notify.dispatch），档位判定 + 焦点判定 + 弹通知都在 main。
// 焦点判定用 BrowserWindow.isFocused()（比渲染层 document.hasFocus() 可靠：
// 窗口最小化/失焦但 document 仍可能有焦点）。
import { appendFileSync } from 'node:fs';
import { BrowserWindow, Notification } from 'electron';
import type { HostSuccess, NotifyDispatchPayload } from '@shared/host-api/contract';
import { getMainWindow, findWindowBySession } from '../main/window-manager';
import { sendHostEventToWindow } from '../main/ipc/host-events';
import { resolveNotifyFocused, shouldNotify, type NotifyMode } from './notify-policy';
import { settingsApi } from './settings-api';

export const notifyApi = {
  dispatch: async (payload: NotifyDispatchPayload): Promise<HostSuccess> => {
    const mode = (await settingsApi.get({ key: 'notifyMode' })) as NotifyMode | undefined;
    // 扩展 UI 请求通知的独立开关（run 完成通知只看 notifyMode 档位）
    const uiRequestEnabled = payload.kind === 'uiRequest'
      ? ((await settingsApi.get({ key: 'notifyUiRequest' })) as boolean | undefined)
      : undefined;
    const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    // 会话已落盘时按「会话所在窗口是否聚焦」判定，避免其他窗口聚焦吞掉本会话的通知；
    // 会话窗口已关（找不到）视为失焦不吞通知；sessionPath 缺省（in-memory）保持任一窗口口径。
    const sessionWindow = payload.sessionPath ? findWindowBySession(payload.sessionPath) : null;
    const focused = resolveNotifyFocused(
      payload.sessionPath,
      sessionWindow ? sessionWindow.isFocused() : null,
      windows.some((w) => w.isFocused()),
    );
    if (!shouldNotify(mode, focused, payload.kind, uiRequestEnabled)) {
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
        // 点击优先聚焦产生通知的会话所在窗口并激活对应面板（与 windows-api 的 focus 路径一致）；
        // 会话未落盘/窗口已关时回退主窗口。
        let target: BrowserWindow | null = null;
        if (payload.sessionPath) {
          const sessionWindow = findWindowBySession(payload.sessionPath);
          if (sessionWindow) {
            if (sessionWindow.isMinimized()) sessionWindow.restore();
            sessionWindow.focus();
            sendHostEventToWindow(sessionWindow, 'windows', 'focusSession', {
              sessionPath: payload.sessionPath,
            });
            target = sessionWindow;
          }
        }
        target ??= getMainWindow() ?? (windows.find((w) => !w.isDestroyed()) ?? null);
        if (target) {
          if (target.isMinimized()) target.restore();
          if (!target.isVisible()) target.show();
          target.focus();
        }
      });
      notification.show();
    } catch {
      // 未签名/无通知权限环境下系统通知可能不可用，静默降级
    }
    return { success: true };
  },
};
