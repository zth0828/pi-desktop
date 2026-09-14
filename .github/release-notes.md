### 📥 下载地址 (Download)

#### 🪟 Windows (不支持 Win7)
- **标准安装版（推荐，支持在线自动静默更新）**：[Windows 64位安装包 (.exe)](https://github.com/zth0828/pi-desktop/releases/download/v1.4.1/Pi.Desktop-Setup-1.4.1-x64.exe)

#### 🍏 macOS (macOS 11.0+)
- **Apple M芯片（M1 / M2 / M3 / M4 系列）**：[Apple M芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.1/Pi.Desktop-1.4.1-arm64.dmg)
- **Intel芯片（老款 Intel 处理器 Mac）**：[Intel芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.1/Pi.Desktop-1.4.1-x64.dmg)

---

## 应用内原地自动无感更新、版本跳跃更新日志、双平台架构精简与多轮长会话贴底优化

本版本基于 `v1.4.0`，引入桌面应用原地静默无感自动更新与版本跳跃变更日志弹窗，全面精简构建架构并专注于 macOS 与 Windows 双平台体验，优化长会话连续提问滚动贴底与历史折叠稳定性，并修复开发模式系统通知图标冲突。

## 核心特性与改进

- **应用内原地自动无感更新与自动重启（In-Place Auto-Update）**：
  - macOS 端更新包下载完成后支持原子解压替换自身并自动拉起，自动清除 macOS Gatekeeper quarantine 隔离属性，无需每次版本升级都手动重新下载并拖入应用程序目录；
  - Windows 端支持静默安装与无感重启；
  - 安装引导对话框内嵌完整可滚动的 Markdown 变更日志展示；
  - 设置页新增「跳过此版本」管理与自动下载更新开关；下载遭遇网络波动时自动指数退避重试并伴有实时 Toast 状态提醒。
- **版本跳跃说明弹窗（Version Jump / What's New）**：
  - 应用更新后首次启动自动弹出「新版更新日志」浮层，清晰展示当前版本的核心特性，点击关闭后自动记为已读不再打扰。
- **架构收敛：专注 macOS 与 Windows 双平台（Streamlined Architecture）**：
  - 彻底清理维护成本较高的 Linux 构建、打包与运行分支，精简 CI/CD 工作流与单测/E2E 运行矩阵；
  - Windows 构建产物移除便携版（Portable），统一收敛为单一标准的 NSIS 安装包，确保安装与原地更新行为完全一致。
- **连续提问滚动贴底防跳顶与长会话折叠优化（Chat Stick-to-Bottom）**：
  - 用户提交新 Prompt 瞬间立即锁定底部并重置滚动位置，彻底解决连续快速提问时由于布局测量与高度抖动引发的向上跳顶现象；
  - 引入 `isTurnCompleted` 精准判定历史轮次完成态，防止长会话流式启动瞬间上一轮因消息事件循环微小间隙发生意外解折叠，保证列表高度绝对平稳。
- **本地开发模式专属 Bundle ID 与通知图标修复（macOS Dev Bundle）**：
  - 为本地开发生成的 `.dev/Electron.app` 注入专属 `CFBundleIdentifier: io.github.zth0828.pidesktop.dev` 并向 LaunchServices 注册，彻底解决本地开发态系统通知回退显示本机微信开发者工具等其他 Electron 应用图标的 Bug。
- **文档与发版导航完善**：
  - README 补充 macOS Gatekeeper、Windows SmartScreen 排错与隐私说明；
  - 发布说明头部提供结构化、可直达的双平台安装包下载链接。

## 验证情况

- TypeScript 严格类型检查 100% 通过（`pnpm typecheck`）。
- 全量单元测试 100% 通过（91 个测试套件，738 项单元测试全部通过）。
- Playwright Electron 端到端全量测试 100% 通过（237 个 E2E 用例全部通过，6 个平台条件性跳过）。
- 中英文字典 key 100% 对齐（`i18n-parity.test.ts` 通过）。

## 安装与升级提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

- **macOS**：打开 DMG 后将 Pi Desktop 拖入「应用程序」文件夹即可。本版本已内置原地自动无感更新，后续新版本可在应用内一键静默自动升级。
- **Windows**：运行 Setup 安装包完成安装，Windows SmartScreen 如提示安全警告请选择“仍要运行”，后续版本同样支持应用内自动更新。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
