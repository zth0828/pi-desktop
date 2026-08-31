## 输入框交互重构、@工作区目录树、应用与 pi 更新卡片解耦及安全增强

本版本基于 `v1.1.0`，带来输入框（Chat Input）全面架构重构、斜杠命令（Slash Commands）上下文补全与拦截确认、`@` 工作区目录树导航穿梭、阶梯式 Escape 快捷撤销、应用与 pi 版本更新卡片独立解耦（含内置 Markdown 发版说明预览）、多镜像断点续传加速、Windows 设备路径防护与 Bash 代理环境无缝注入。

## 新功能

- **斜杠命令（Slash Commands）交互与补全系统增强**：
  - 支持上下文斜杠触发、Space 空格补全与 Enter 直接执行；
  - 拦截未知或无效的斜杠命令并弹出确认对话框，防止手滑将命令当做普通提示词误发给模型；
  - 壳内建命令（`/new`、`/session`、`/settings`、`/compact` 等）就地分发与清空输入框；
  - 斜杠命令面板底部新增清晰的快捷键操作指引与一键关闭按钮；
  - 修复长命令列表滚动被遮挡问题，支持键盘上下导航时高亮项自适应滚入可视区域。
- **`@` 文件引用与工作区目录树**：
  - 输入 `@` 即时呼出完整工作区目录树层级视图；
  - 支持左右方向键（`ArrowLeft`/`ArrowRight`）进行目录层级穿梭与 `Tab` 键快速展开/折叠目录；
  - 未匹配的文件引用在发送前弹出拦截确认框；
  - 精准区分引用文件与附件，支持图片及多种文档引用。
- **阶梯式 Escape 撤销与全局快捷键**：
  - 支持阶梯式 Esc 撤销（优先关闭补全弹窗/确认弹窗 → 逐个移除待发暂存 Skill/附件/模式 → 清除输入）；
  - 全局模态框、抽屉（Drawer）与各类浮层支持 Esc 一键关闭。
- **打字机动态问候语**：
  - 聊天初始页面新增多语言轮播打字机问候语与呼吸光标动效。
- **应用更新与 pi 升级卡片分离解耦**：
  - 设置页将 Pi Desktop 自身更新与全局 pi CLI 升级拆分为独立卡片；
  - 应用更新支持内嵌 Markdown 渲染的 Release Notes 预览与官方 Logo 标识；
  - 在最新版本时提供即时的「已是最新」动画与视觉反馈；
  - 点击通知 Toast 中的「前往下载」平滑滚动定位至设置页对应卡片。
- **多通道镜像加速与下载断点续传**：
  - 内置 GitHub 官方、自定义镜像与 npmmirror 多通道自动故障切换与兜底；
  - 支持 HTTP Range 断点续传、Linux 资产命名自适应与 24 小时免打扰静默检测周期。
- **会话管理与卡片视觉**：
  - 会话信息弹层升级为现代化卡片式布局（现代排版、多维度统计与中英双语对齐）；
  - 内存中空会话提供直观的「未保存」状态指示。

## 安全与稳定性优化

- **路径安全与跨平台防护**：
  - 强制拒绝 Windows 设备路径（`\\.\`、`\\?\`、`COM1` 等）注入；
  - 工作区文件安全预览采用回合作用域权限授权（Turn-scoped preview grants）。
- **环境代理注入与 Bash 执行**：
  - 桌面应用配置的代理环境变量（`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`）无缝注入本地 Bash 执行环境；
  - 强化会话原子写盘与 JSONL 损坏容错机制。
- **运行时资源回收**：
  - 主进程引入 pending dispose 扫尾与超时兜底，杜绝僵死 runtime 进程残留。
- **输入层架构解耦**：
  - 将庞大的 ChatInput 组件彻底解耦为模块化 hooks（`useSlashCommands`、`useFileMentions`、`useAttachments` 等）与独立子组件。

## 验证情况

- 本地通过 TypeScript 严格类型检查、全量单元测试（75 个测试套件，595 个单元测试 100% 通过）。
- pi 原生 SDK 契约测试 100% 通过。
- Playwright Electron 端到端全量测试（38 个测试套件，215 个 E2E 测试 100% 通过）。
- CI 在 macOS、Windows、Linux 上分别执行类型检查、单元测试、Vite 构建与安装包 smoke test，全绿。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
