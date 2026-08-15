// 耗时插桩：main 侧在 PI_DESKTOP_TIMING=1 时给窗口 URL 带上 ?timing=1，
// 渲染层据此开启同格式打点（[timing] <epoch-ms> <label>），供测量脚本收集。
const enabled = new URLSearchParams(window.location.search).has('timing');

export function timingMark(label: string): void {
  if (enabled) console.debug(`[timing] ${Date.now()} ${label}`);
}

export function timingEnabled(): boolean {
  return enabled;
}
