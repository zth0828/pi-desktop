// 流式合帧节流（多面板 P4，docs/MULTI-WINDOW-PANES-PLAN.md §16/17）。
// pi 流式 partial / 工具进度事件的频率远高于渲染需要，逐个进 store 会让渲染帧率随
// SSE chunk 频率线性增长（多面板并发时按面板数放大）。本模块在 ≤FLUSH_MS 窗口内合并
// "替换式"流式事件（同类同键只保留最新一条，语义不丢），窗口结束或关键事件到达时
// 批量应用；关键事件（run 起止/消息完结/工具起止/排队/重试/compaction）直透不延迟。
// 纯模块、node-safe（只用 setTimeout，不引 react/DOM），单测可直接引用。
export const STREAM_FLUSH_MS = 50;

/** 事件分类：delta = 可合并的替换式流式事件（key 相同的只保留最新）；immediate = 直透 */
export type StreamClass = { kind: 'delta'; key: string } | { kind: 'immediate' };

export type StreamBatcher<T> = {
  /** 入口：delta 入窗合并；immediate 先 flush 窗口内积压再直透（保序） */
  push: (item: T) => void;
  /** 立即应用窗口内全部积压（按到达顺序） */
  flush: () => void;
  /** 清理定时器并丢弃积压（store dispose 时调用，防止悬挂 flush 打到已销毁实例） */
  dispose: () => void;
};

export function createStreamBatcher<T>(
  apply: (item: T) => void,
  classify: (item: T) => StreamClass,
  flushMs: number = STREAM_FLUSH_MS,
): StreamBatcher<T> {
  let pending: Array<{ key: string; item: T }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const entry of batch) apply(entry.item);
  };

  return {
    push: (item) => {
      const cls = classify(item);
      if (cls.kind === 'immediate') {
        flush();
        apply(item);
        return;
      }
      // 替换式语义：同键旧条目原地替换，保持与其余事件的相对顺序
      const existing = pending.findIndex((entry) => entry.key === cls.key);
      if (existing >= 0) pending[existing] = { key: cls.key, item };
      else pending.push({ key: cls.key, item });
      if (timer === null) timer = setTimeout(flush, flushMs);
    },
    flush,
    dispose: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = [];
    },
  };
}
