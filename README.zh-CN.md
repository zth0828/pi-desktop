<div align="center">
  <img src="./resources/icon.png" width="128" height="128" alt="Pi Desktop 图标">
  <h1>Pi Desktop</h1>
  <p><strong>为 pi coding agent 打造的桌面工作台。</strong></p>
  <p>在一个专注的应用中完成对话、工具执行、代码评审、会话管理和能力扩展。</p>
  <p>
    <a href="README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a>
  </p>
  <p>
    <a href="https://github.com/zth0828/pi-desktop/actions/workflows/ci.yml"><img src="https://github.com/zth0828/pi-desktop/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://github.com/zth0828/pi-desktop/releases"><img src="https://img.shields.io/github/v/release/zth0828/pi-desktop?include_prereleases&label=preview" alt="最新预览版"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-personal%20%26%20non--commercial-blue" alt="个人及非商业许可证"></a>
  </p>
</div>

Pi Desktop 将 [pi](https://github.com/badlogic/pi-mono) 变成具有原生软件体验的桌面
工作区，同时不会替换 pi 的运行时。模型、会话、工具、Skills、Packages、扩展和
配置仍然来自 pi；桌面端负责让这些能力更直观、更易控制，也更适合日常使用。

> [!IMPORTANT]
> Pi Desktop 不内置也不 fork pi。它加载用户全局安装的 pi SDK，并继续使用 pi
> 原生配置和会话文件。项目仍在积极开发，当前下载版本为未签名预览包。

![Pi Desktop 流式对话与富 Markdown 输出](./resources/screenshots/chat.png)

## 为什么使用 Pi Desktop

### 一个完整的编码闭环，而不是互不相关的页面

让 pi 调查项目，实时查看它的工作过程和工具调用，在同一窗口检查文件与 diff，
然后继续当前会话。对话、工作区和改动评审始终相互关联。

### 原生复用 pi，不实现第二套 agent

Pi Desktop 不运行自己的 LLM 循环，也不会发明桌面端专属会话格式。它适配 pi 的
SDK、事件、设置、包管理器和扩展系统。在桌面端创建的工作仍然是原生 pi 工作。

### 自由选择模型与供应商

可以使用 pi 内置供应商、API Key 或 OAuth、自定义 OpenAI 兼容端点、LM Studio 等
本地服务，以及 pi 扩展注册的 Provider。界面中可查看上下文限制和价格、探测自定义
连接，并切换当前模型。

### 本地优先的项目控制

工作区、pi 配置、凭证和会话历史都保留在原生本地位置。Pi Desktop 从用户环境动态
定位 Node.js、npm 和 pi，不会再捆绑一套隐藏运行时。

### 直接接入 pi 生态

Skills、Prompt 模板、主题、扩展和 MCP 仍然使用 pi 原生机制。Pi Desktop 提供发现
与配置体验，实际安装和执行继续交给 pi。

## 功能全景

| 领域 | 已实现能力 |
| --- | --- |
| **Agent 对话** | 流式文本与思考过程、工具调用进度、停止/排队/插队、斜杠命令、Plan mode 集成、富 Markdown、任务列表、表格、代码块、复制操作、文件引用和图片附件 |
| **工作区** | 按需展开的文件浏览器；文本、代码、图片、Markdown、PDF、DOCX、XLSX、CSV 预览；使用本机应用打开；响应式停靠或覆盖布局 |
| **改动评审** | Git 与非 Git 改动检测、staged/unstaged/untracked/conflict 状态、双栏或统一 diff、文件级与 hunk 级确认回滚、每轮结束后的编辑文件汇总 |
| **会话管理** | 按项目组织历史记录、按标题和消息搜索、重命名、运行状态、切换、fork、分支树、归档/恢复、删除、上下文压缩和独立 HTML 导出 |
| **模型管理** | 内置与扩展 Provider、API Key、OAuth、自定义兼容端点、协议探测、模型发现、上下文与输出限制、Token 价格、思考等级、用量和费用详情 |
| **pi 生态** | 读取当前 Skills、浏览官方包目录、查看包元数据与 README、安装/更新/卸载包、配置全局或项目 MCP Server、渲染受支持的扩展对话框/Widget/通知 |
| **桌面体验** | 浅色/深色/跟随系统主题、中英文界面、会话搜索快捷键、可折叠侧栏、通知策略、发送键与后续消息行为、阻止休眠和 pi 环境诊断 |

## 产品导览

### 一边对话，一边评审代码

![Pi Desktop 工作区与 Git diff 评审](./resources/screenshots/review.png)

右侧工作台让源文件和改动始终贴近对话。工具活动会折叠为易读的回合记录，编辑过的
文件则持续可见，方便检查或回滚。

### 为每个项目选择合适的模型栈

![Pi Desktop 模型与供应商](./resources/screenshots/models.png)

凭证仍保存在 pi 原生存储中。Pi Desktop 为 Provider 状态、可用模型、上下文窗口、
输出限制和当前模型提供清晰的管理界面。

### 把会话当作长期项目资产

![Pi Desktop 会话管理](./resources/screenshots/sessions.png)

会话不是一次性的聊天标签。你可以继续旧工作、fork 另一种实现思路、归档已完成的
任务，或者导出一份独立 HTML 记录。

### 通过 pi Packages 扩展能力

![Pi Desktop Packages 发现页](./resources/screenshots/packages.png)

发现扩展和 Skills、检查源码与包详情，再由 pi 原生包管理器完成安装。截图使用隔离的
离线演示目录，并采用具有代表性的 pi 生态包名称。

## 架构原则

体验层与能力层保持严格边界：

```text
React 渲染层
    │  window.pidesktop.hostInvoke（类型化契约）
Electron 主进程
    │  服务适配层 + 集中式事件映射
用户安装的 pi SDK / CLI
    │
模型 · 会话 · 工具 · Skills · Packages · 扩展
```

- 渲染层不直接 import pi，也不直接访问 Electron IPC。
- 主进程中的 pi 集成集中在 `electron/services/`。
- pi 事件只在一个共享映射器中转换为桌面事件。
- pi、npm 和二进制路径均动态发现，并在比较前解析真实路径，包括 macOS 符号链接。
- 测试使用隔离的 pi 目录和本地 mock provider，不消耗真实 API 配额，也不读取私人会话。

## 环境要求

- 支持 macOS、Windows 和 Linux。GitHub Actions 会构建跨平台安装包；项目仍处于
  预览阶段，需要更多真实设备验证。
- Node.js 22.19.0 或更高版本
- npm
- pnpm 10.32.1（推荐使用 Corepack）
- pi 0.83.0 或更高版本，并且必须通过 npm 全局安装

安装 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
pi --version
```

## 下载预览版

从 [GitHub Releases](https://github.com/zth0828/pi-desktop/releases) 下载对应平台的
安装包。打开前请对照随 Release 发布的 `SHA256SUMS-<platform>.txt` 校验文件。

当前预览包**尚未进行代码签名或 Apple 公证**：

- **macOS：** Gatekeeper 首次启动时可能阻止打开。右键点击 Pi Desktop 并选择
  **打开**，或在**系统设置 → 隐私与安全性**中允许打开。
- **Windows：** 可能出现 Microsoft Defender SmartScreen。确认校验和与仓库来源
  后，选择**更多信息 → 仍要运行**。
- **Linux：** AppImage 必要时先执行 `chmod +x Pi-Desktop-*.AppImage`。

正式代码签名与 macOS 公证需要平台证书，后续会单独接入。系统警告不代表文件已经
损坏，但对于无法确认来源或校验和的文件，请勿绕过安全提示。

## 从源码运行

```bash
git clone https://github.com/zth0828/pi-desktop.git
cd pi-desktop
corepack enable
pnpm install
pnpm dev
```

Pi Desktop 启动时会检测 Node.js、npm、pi 的安装方式和版本。引导流程可以提示或执行
受支持的 npm 安装，但不会接管 pi 升级。

## 开发与测试

```bash
pnpm typecheck       # Main、preload、shared 和 renderer TypeScript
pnpm test            # 单元测试
pnpm test:contract   # 使用本地 SSE provider 验证 pi SDK 契约
pnpm test:e2e        # Electron 端到端测试
pnpm build:vite      # 生产环境 renderer/main/preload 构建
```

使用隔离演示数据重新生成 README 中的全部截图：

```bash
pnpm screenshots:readme
```

## 项目状态

桌面端核心工作流已经实现，并由 Electron E2E 覆盖。CI 会在 macOS、Windows 和
Linux 上验证源码构建，版本标签会为三个平台生成未签名预览包。签名与公证、自动
更新以及更广泛的真实设备发行验证仍是后续工作。

## 参与贡献

欢迎通过 [Issues](https://github.com/zth0828/pi-desktop/issues) 提交 Bug 报告、
产品建议，以及范围清晰的 Pull Request。

1. 先搜索已有 Issue，并清楚描述面向用户的问题或工作流。
2. Agent 能力应放在 pi 或 pi 扩展中；Pi Desktop 负责体验和集成层。
3. 根据改动风险补充测试；渲染层 UI 变更必须提供 Electron Playwright 覆盖。
4. 提交前运行上面的相关检查。
5. 报告问题时请勿附带密钥、API Key 或私有 pi 会话。

## 许可证

Pi Desktop **允许个人、教育、研究及其他非商业用途免费使用**。商业使用必须事先
获得版权所有者的书面授权。完整条款见 [LICENSE](LICENSE)。

这是一个源码可见项目，并非采用 OSI 认可的开源许可证。第三方组件继续遵循其原始
许可证，归属信息见 [NOTICE](NOTICE)。

## 致谢

- [pi](https://github.com/badlogic/pi-mono) 提供 coding agent 运行时。
- 少量 Electron 基础设施文件基于 MIT 许可证从 ClawX 调整而来。这属于实现层面的
  代码复用，不代表产品依赖或共享 agent 运行时。准确范围记录在 [NOTICE](NOTICE)、
  源码注释和对应提交中。
