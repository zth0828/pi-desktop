### 📥 下载地址 (Download)

#### 🪟 Windows (不支持 Win7)
- **标准安装版（推荐，支持在线自动更新）**：[Windows 64位安装包 (.exe)](https://github.com/zth0828/pi-desktop/releases/download/v1.4.3/Pi.Desktop-Setup-1.4.3-x64.exe)

#### 🍏 macOS (macOS 11.0+)
- **Apple M芯片（M1 / M2 / M3 / M4 系列）**：[Apple M芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.3/Pi.Desktop-1.4.3-arm64.dmg)
- **Intel芯片（老款 Intel 处理器 Mac）**：[Intel芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.3/Pi.Desktop-1.4.3-x64.dmg)

> [!TIP]
> **macOS 首次打开若提示“已损坏，无法打开”**：  
> 由于开源预览版未接入 Apple 开发者证书签名公证，首次拖入「应用程序」后若被系统 Gatekeeper 拦截，请打开系统终端（Terminal）执行以下命令解除隔离：  
> ```bash
> sudo xattr -rd com.apple.quarantine "/Applications/Pi Desktop.app"
> ```

---

## Companion 伴侣扩展生态、沉浸式 Extension UI 停靠弹窗、计划模式协同与导航定位增强

本版本基于 `v1.4.2`，核心引入**内置伴侣扩展机制（Companion Extensions）与沉浸式交互 UI 弹窗（Docked Extension UI）**，提供免 npm 依赖的 `ask-question` 伴侣扩展一键启用体验，并在对话提问时提供智能交互引导；升级 `ctx.ui` 交互弹窗为输入框吸附停靠卡片，支持 1-9 数字键极速应答；深度完善计划模式（Plan Mode）生态联动与退出清理；优化消息导航轨动态跟踪贴底定位；修复代理环境下开发启动白屏问题并全面更新产品巡览图文。

## 核心特性与改进

- **内置伴侣扩展机制与智能交互引导（Companion Extensions）**：
  - **免依赖内置扩展**：打包自带 `ask-question.ts` 伴侣扩展（通过 Electron 资源目录分发），支持在「扩展」页面一键安装至 `~/.pi/agent/extensions/`，免除手动 npm 依赖安装；
  - **智能提问检测与交互提示**：当助手输出包含编号列表的提问时，聊天区域自动展示智能选择提示条，引导一键开启伴侣扩展或跳转管理；
  - **RPC 模式绑定**：扩展绑定时声明 `rpc` 模式，确保扩展能够识别桌面 UI 环境并调起原生交互组件。
- **沉浸式交互 UI 对话框（Docked Extension UI）**：
  - **吸附停靠不挡视线**：将原居中模态遮罩改为吸附在输入框上方的自适应悬浮卡片，彻底避免遮挡聊天历史与上下文；
  - **键盘极速操作**：支持 1-9 数字键键盘快捷选择，自动清洗选项多余序号前缀，提供丝滑的操作反馈与响应式布局。
- **计划模式（Plan Mode）生态与生命周期协同**：
  - **依赖按需检测**：开启计划模式时自动检测社区扩展（`@narumitw/pi-plan-mode`），未安装时弹窗引导一键安装，避免静默失效；
  - **生命周期同步退出**：关闭输入框 Plan 开关或输入 `/plan exit` 时，自动向运行时派发退出指令，即时清理 Plan 部件与状态；
  - **指令分发优化**：支持 `/plan <prompt>` 直接带参数派发，修复编辑历史 `/plan` 消息时输入框被意外清空的问题，防止重复添加模式前缀。
- **对话导航与开发体验优化**：
  - **消息导航轨贴底与动态追踪**：末尾锚点点击自动平滑滚动至会话最底部，完整展现长回复；普通跳转支持逐帧动态跟踪懒加载高度膨胀并平稳回正；
  - **开发服务白屏修复**：明确绑定 `127.0.0.1` 并为 Chromium 注入代理绕过参数，解决 macOS 及系统代理环境下因 `localhost` 无法连接导致的启动白屏；
  - **全套产品巡览与图文更新**：README 补充消息导航轨、历史轮次折叠与耗时统计、会话分支树（Fork Tree）等特性介绍，并全面刷新截图资产。

## 验证情况

- TypeScript 严格类型检查 100% 通过（`pnpm typecheck`）。
- 全量单元测试 100% 通过（96 个测试套件，760 项单元测试全部通过）。
- SDK 契约测试 100% 通过（`pnpm test:contract`）。
- 中英文字典 key 100% 对齐（`i18n-parity.test.ts` 通过）。

## 安装与升级提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

- **全新安装**：根据操作系统与芯片类型下载上方 DMG 或 EXE 安装包；
- **后续更新**：检测到新版本时将在应用内自动优先下载极小增量补丁包，一键秒级更新重启生效！

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
