// 运行时防止系统休眠：agent 运行期间（run.started → run.ended，含自动重试等待）
// 用 powerSaveBlocker('prevent-display-sleep') 顶住休眠。main 侧自治（事件桥直接挂钩，
// 不经过渲染层）。受 settings.preventSleep 开关控制（默认关，保守）。
import { appendFileSync } from 'node:fs';
import { powerSaveBlocker } from 'electron';
import { settingsApi } from './settings-api';

let blockerId: number | null = null;
/** 期望保持阻塞状态（run 进行中）；设置读取是异步的，用它挡住 start/stop 竞态 */
let wantBlock = false;

/** E2E 观测钩子（同 notify 的 PI_DESKTOP_E2E_NOTIFY_LOG 模式）：按行落 JSON。 */
function log(action: 'start' | 'stop'): void {
  const logPath = process.env.PI_DESKTOP_E2E_POWER_LOG;
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${JSON.stringify({ action, at: Date.now() })}\n`);
  } catch {
    // 日志不可写不影响本体
  }
}

/** run 开始：开关开启且无活动 blocker 时启动阻止休眠。 */
export function noteRunStarted(): void {
  if (wantBlock) return;
  wantBlock = true;
  void (async () => {
    const enabled =
      ((await settingsApi.get({ key: 'preventSleep' }).catch(() => undefined)) as
        | boolean
        | undefined) === true;
    if (!enabled) {
      wantBlock = false;
      return;
    }
    if (!wantBlock || blockerId != null) return; // 设置读取期间 run 已结束
    try {
      blockerId = powerSaveBlocker.start('prevent-display-sleep');
      log('start');
    } catch {
      wantBlock = false;
    }
  })();
}

/** run 结束：willRetry（自动重试等待）时保持阻塞，否则解除。会话替换/运行时销毁也走这里兜底。 */
export function noteRunEnded(willRetry?: boolean): void {
  if (willRetry) return;
  wantBlock = false;
  if (blockerId == null) return;
  try {
    powerSaveBlocker.stop(blockerId);
  } catch {
    // 已失效的 id 静默忽略
  }
  blockerId = null;
  log('stop');
}
