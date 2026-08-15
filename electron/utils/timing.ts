// 耗时插桩（PI_DESKTOP_TIMING=1 时生效）：单条 console 输出时间戳 + 标签，
// 由测量脚本收集后计算各段差值。默认关闭，正常运行的日志零噪音。
const enabled = process.env.PI_DESKTOP_TIMING === '1';

export function timingMark(label: string): void {
  if (enabled) console.log(`[timing] ${Date.now()} ${label}`);
}

export function timingEnabled(): boolean {
  return enabled;
}
