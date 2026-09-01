## 会话置顶管理、模型上下文滑块与预设、Material 图标体系与跨平台稳定性增强

本版本基于 `v1.2.0`，带来会话置顶（Pin / Unpin）与所属项目来源展示、模型上下文窗口（Context Window）滑块调节与自适应预设、Material Icon Theme 风格文件图标与胶囊式附件卡片、统一国际化错误格式化，以及新建会话生命周期与跨平台打包等多项稳定性增强。

## 新功能

- **会话置顶与跨项目管理（Session Pinning）**：
  - 支持在侧边栏及全局会话管理页面中一键置顶/取消置顶会话；
  - 侧边栏顶部新增专属「置顶会话」独立分组，优先展示且常驻图钉标识；
  - 置顶会话支持双行布局清晰展示所属项目文件夹名称（跨平台路径解析 `getProjectName`）；
  - 引入固定 indicator slot 保证活动中与普通状态下的文字与图标垂直对齐；
  - 重构项目分组头部交互，统一单文件夹折叠/展开指示图标。
- **模型上下文窗口（Context Window）动态调节与自适应预设**：
  - 模型切换弹层深度集成上下文窗口调节滑块与用量指示器；
  - 智能匹配当前模型的上下文限制并提供自适应推荐预设档位（200k / 256k / 272k / 400k / 500k / 1M 等）；
  - 自动压缩阈值调整与低配警示提示；
  - 通过 host-api 与 pi session adapter 实时动态调整模型上下文窗口限制。
- **Material Icon Theme 文件图标与胶囊式附件卡片**：
  - 引入专用 Material Icon Theme 风格矢量文件图标，覆盖主流编程语言、文档、配置文件与多媒体；
  - 聊天输入框与消息历史中的文件附件全面升级为高颜值胶囊卡片（Capsule Card）与类型角标；
  - 工作区资源管理器、文件标签页及变更审查视图全面对齐高辨识度图标展示。
- **统一错误格式化与国际化本地化（Error i18n）**：
  - 封装 `formatErrorMessage` 统一处理后端运行时错误代码映射、IPC 超时格式化与工作区路径安全提示；
  - 补齐 zh / en 错误文案键值，实现 100% 翻译覆盖；
  - 全面应用至聊天错误横幅、运行时错误通知、会话加载状态及会话搜索对话框。

## 稳定性与跨平台修复

- **新建会话生命周期与状态隔离**：
  - 修复从已有会话切换至内存新建会话时的窗口绑定残留问题，避免后续发消息误报「session not started」；
  - 阻断旧会话 running 状态向新建会话扩散，确保新建会话处于干净的空闲态；
  - 将会话切换与新建操作纳入慢任务 90 秒超时豁免，前端替换等待延长至 30 秒，避免冷启动误报超时。
- **键盘循环导航（Wrap-around Navigation）**：
  - 文件引用（`@`）与斜杠命令（`/`）弹窗在列表及树形模式下均支持方向键首尾循环选中。
- **跨平台窗口与打包规范**：
  - 跨平台统一固定应用名 `Pi Desktop`，解决 Linux 下 WM_CLASS 匹配问题；
  - 非 macOS 平台动态挂载窗口图标，优化 Linux 托盘图标缩放；
  - 规范 electron-builder Linux 桌面配置层级结构。

## 验证情况

- 本地通过 TypeScript 严格类型检查、全量单元测试（78 个测试套件，626 个单元测试 100% 通过）。
- pi 原生 SDK 契约测试 100% 通过。
- Playwright Electron 端到端全量测试（219 个 E2E 测试 100% 通过，8 个跨平台专测按平台环境跳过）。
- Vite 构建与 electron-builder smoke test 验证通过。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
