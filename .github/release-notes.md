## 富文本内联文件胶囊、动态代理穿透、长会话视口渲染与工作台多维拖拽布局

本版本基于 `v1.2.1`，带来基于 ContentEditable 的内联文件胶囊编辑器、终端子进程动态代理穿透、长会话按需视口渲染优化、输入历史浏览与草稿保护、工作台全量命令历史与分栏拖拽把手、侧边栏自由缩放、会话管理全局折叠与回到底部等多项功能特性与跨平台体验优化。

## 新功能

- **富文本内联文件胶囊编辑器（Inline File Capsules & Rich Composer）**：
  - 聊天输入框重构为基于 ContentEditable 的富文本实体编辑器，文件引用在光标所在位置直接渲染为带专属文件图标与删除按钮的内联胶囊（Capsule Badge）；
  - 支持自然句子中混排文件引用、原子级 Backspace 一键删除胶囊、拖拽工作区文件在光标处插入；
  - 支持分步 Escape 撤销暂存与保持输入光标及焦点；
  - 对话历史气泡中全面统一展示带真实类型图标的内联文件卡片；
  - 双向序列化为原生 `@file` 提示词文本，保持与 pi 原生 CLI 及 Playwright E2E 自动化完全兼容。
- **终端子进程动态代理穿透（Subprocess Proxy Penetration）**：
  - 内存同步缓存当前生效的代理配置；
  - 通用 adapter 执行用户命令及 agent 执行 bash 工具子进程时，完整穿透代理环境变量（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`），解决开发服务与终端工具的网络隔离问题。
- **输入历史浏览与草稿保护（Composer History Traversal）**：
  - 输入框支持方向键（↑ / ↓）遍历历史发送记录；
  - 具备严格的现场草稿保护机制，遍历回退到底部时完整恢复未发送的草稿输入。
- **上下文高阈值预警条与一键压缩（Context Warning Bar）**：
  - 输入框上方集成模型上下文容量预警条，当会话 token 占用达到阈值时展示百分比指示并提供一键 Compact 压缩入口。
- **工作台会话命令历史与分栏拖拽布局（Workbench Splitters & Command History）**：
  - 命令面板汇总并展示当前会话全量执行过的命令历史清单；
  - 工作区文件树与代码审查变更列表引入可拖拽调整宽度的分隔条（Draggable Splitter），支持双击重置并具备无障碍支持。
- **侧边栏自由拖拽调整（Resizable Sidebar）**：
  - 侧边栏支持边缘自由拖拽调整宽度，支持双击把手恢复默认尺寸；
  - 修复 macOS 下折叠状态时的界面布局对齐。
- **全会话管理折叠与回到底部（Sessions Page Polish）**：
  - 会话管理页支持项目分组独立折叠/展开，顶部常驻全局一键全部展开/折叠控件；
  - 新增浮动一键直达底部按钮，优化页面切换时的无感知静默刷新。
- **窗口居中初始摆放与对称审查面板扩展（Centered Window & Symmetric Expansion）**：
  - 新建主窗口在主显示器工作区精确几何居中；
  - 展开或关闭 docked 工作台/审查面板时，原生窗口以窗口中心向两侧对称缩放，不再单向向右偏移。
- **代码审查与工具卡片导航联动（Direct Navigation to Review）**：
  - 工具卡片与回合文件改动清单支持一键直达评审面板并自动聚焦选中目标文件；
  - 精简已完成工具卡，增强命令展示清晰度与回合折叠状态栏。

## 性能优化

- **长会话按需视口渲染（Long Session Viewport Virtualization）**：
  - 当会话消息数超过 40 条时，自动启用基于估算高度的视口按需渲染，显著降低长会话 DOM 节点数与渲染耗时；
  - 严格保持消息 DOM 锚点 ID，保证导航 rail 与跳转完全正常；
  - 审查面板命令清单引入 50 项增量懒加载。

## 稳定性与跨平台修复

- **跨平台窗口与系统托盘对齐**：统一应用名 `Pi Desktop`，优化 Windows/Linux 窗口图标与托盘图标缩放。
- **Windows 环境兼容性**：支持 Windows 下通过 node 入口拉起 vite dev；解决 `pnpm dev` 启动问题；使用专用 dev AUMI 让任务栏正确展示窗口图标；避免 npm install 时的 Node DEP0190 告警。
- **后台通知与窗口聚焦**：后台会话完成后在同一窗口弹窗提示；无窗口承载时点击通知自动唤起会话；优化多平台窗口聚焦激活。
- **聊天生命周期与流式恢复**：修复会话切换与发消息 IPC 的竞争时序（awaitingRun）；修复流式中断时的错误捕获与 assistant 异常信息回显；条件化展示 cache write（大于 0 时才显示）。
- **更新检查镜像前缀规整**：规整更新源 mirror 前缀去除多余斜杠。
- **审查面板 Write 工具完整 Diff 生成**：针对 write 工具创建的文件生成完整的全部新增（Full Addition）Diff，并提供工作区 Diff 兜底。
- **文件拖拽去重**：防止向输入框拖拽同名或重复文件。
- **导航 Rail 底部高亮精度修复**：对齐底部激活容差，在小数与视口缩放时稳定高亮最新消息圆点。

## 验证情况

- TypeScript 严格类型检查 100% 通过（`pnpm typecheck`）。
- 全量单元测试 100% 通过（84 个测试套件，667 个单元测试全部通过，1 个跨平台专测按平台环境跳过）。
- pi 原生 SDK 契约测试 100% 通过（3 个契约测试全部通过）。
- Playwright Electron 端到端全量测试 100% 通过（38 个 spec，221 个 E2E 测试全部通过，8 个跨平台专测按平台环境跳过）。
- Vite 构建与 electron-builder smoke package 验证通过。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
