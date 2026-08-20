## 版本检查、无证书更新下载与会话运行状态修复

本版本是 `0.2.2` 的功能版本，新增 Pi Desktop 与 pi 的自动版本检查、跨平台安装包下载与 SHA-256 校验，并修复了运行中会话切换后的控制与时序问题。

- **自动版本检查**：启动后自动检查 Pi Desktop（GitHub Releases）与 pi（npm registry）的最新版本，最多每 7 天联网一次；手动“立即检查”可随时强制执行。检查结果（最新版本、上次成功时间、错误）持久化在壳设置中，失败不会阻塞主界面。
- **无证书更新下载**：发现新版本后按当前平台与架构选择安装包（macOS 优先 DMG，Windows 优先 NSIS Setup，Linux 优先 AppImage、DEB 备用），流式下载到用户目录，并用同 Release 发布的 `SHA256SUMS-<platform>.txt` 校验 SHA-256；校验失败或下载中断会删除临时文件。下载完成后提供“打开安装包 / 显示文件位置”，不会自动执行任何安装包。
- **设置页版本区**：在“关于”区域分开展示 Pi Desktop 与 pi 的当前版本、最新版本、最近检查时间和错误，提供立即检查、下载更新、升级 pi 按钮（双语）。
- **Linux 资产命名兼容**：按 workflow 实际发布的 `x86_64` AppImage 与 `amd64` DEB 资产名匹配。
- **测试与注入**：GitHub 与 pi registry 地址可用环境变量注入（生产默认官方地址），E2E 使用本地 mock server，不依赖真实网络。
- **会话运行状态修复**：运行中的会话切换到其他会话再切回后，仍能显示停止按钮并可用 Escape 停止；历史会话切换后消息列表会钉回最新消息；Models 页切换模型的推理开关后，聊天页思考深度菜单立即恢复可用。

## 验证情况

- 本地已通过 TypeScript 检查、单元测试和生产构建。
- 全量 Playwright Electron E2E：138 个用例通过 137 个、跳过 1 个，无失败（覆盖聊天、多会话、多窗口、面板、队列、模型、Review、Workspace、设置、导出、归档、搜索、扩展、MCP、技能、信任等）。
- 发布工作流会在 macOS、Windows 和 Linux 上分别执行类型检查、单元测试、Vite 构建和安装包构建。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
