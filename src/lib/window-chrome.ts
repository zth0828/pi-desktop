// Windows/Linux frameless 自绘顶部（Row 1 标题栏 + Row 2 工具行）的跨组件桥梁。
// Row 2 工具行由 App 挂载；Chat 页的 session-titlebar 经 portal 注入该行，
// 实现「标题栏 + 会话标题 + 右侧面板开关」的单一工具行（macOS 保持原样，不参与）。
export const windowChrome = {
  /** Row 2 工具行的会话标题 portal 插槽（App 挂载，Chat 页注入；null = 未挂载）。 */
  toolbar: null as HTMLElement | null,
};

/** 是否使用自绘顶部（preload 同步暴露平台，首帧即确定；非 darwin 即 Windows/Linux）。 */
export function isWindowsChrome(): boolean {
  const platform = (globalThis as { window?: { pidesktop?: { platform?: string } } })
    .window?.pidesktop?.platform;
  return platform !== undefined && platform !== 'darwin';
}
