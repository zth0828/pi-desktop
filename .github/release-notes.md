## Windows/Linux 兼容性与会话体验修复

本版本是 `0.2.1` 的补丁更新，重点修复跨平台侧栏操作，并完善会话、上下文与运行时体验。

- **Windows/Linux 侧栏修复**：侧栏收起后，内容区左上角会显示悬浮控制按钮，可重新展开侧栏；避免展开入口随侧栏一起隐藏。
- **Windows 兼容性**：兼容 npm shim 的全局包路径、反斜杠路径、大小写不敏感路径比较、Git `autocrlf`，并补充 Windows Electron E2E fixture 适配。
- **多窗口会话隔离**：同一会话只由一个窗口持有；重复打开、拖入或拖出时聚焦已有窗口，避免不同窗口竞争同一 runtime。
- **上下文压缩体验**：压缩后仍可浏览和搜索完整当前分支历史，增加压缩检查点导航、压缩结果与上下文估算展示。
- **Token 与缓存统计**：恢复历史会话后正确读取上下文和会话累计用量；回合卡片中的缓存命中率改为整个会话累计口径。
- **输入与运行时设置**：保留各面板未发送草稿，支持 `!` Bash 命令、基于 `fd` 的 `@` 文件补全、默认思考深度、自动重试和自动压缩开关。
- **Agent 原生能力**：接入项目信任门控、分层停止/中断、跳分支摘要选项，以及 MCP 配置立即重载。
- **其他修复**：会话删除后的面板切换、失败回复错误展示、Vite 热重载时 Electron 安全重启，以及扩展调用 TUI 专属 UI 时的一次性提示。

## 验证情况

- 本地已通过 TypeScript 检查、单元测试和生产构建。
- Windows/Linux 侧栏展开入口的修复提交已包含在 `main`，且未被后续改动覆盖。
- 发布工作流会在 macOS、Windows 和 Linux 上分别执行类型检查、单元测试、Vite 构建和安装包构建。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 预览安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
