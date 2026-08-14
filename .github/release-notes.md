## Windows Node.js / npm 环境检测修复

修复 #12：Windows 上的 npm 通过 `npm.cmd` 命令 shim 提供。此前 Pi Desktop 虽然能检测到 Node.js v24，但无法执行 npm，并将 npm 检测失败错误显示为“Node.js 版本低于要求”。

本版本会从已定位的目录通过 Windows shell 执行 `.cmd` / `.bat` shim，兼容 `C:\Program Files\nodejs` 等包含空格的标准安装路径。Node.js 版本达标但 npm 缺失或无法运行时，引导页也会显示准确的 npm 错误，不再误报 Node.js 版本。

## 验证情况

- Windows Server 2025 CI 已使用真实 `npm.cmd` 完成环境检测单元测试。
- macOS、Windows、Linux 均通过 TypeScript 检查、完整单元测试、pi SDK 契约测试和安装包 smoke build。
- 106 个 Electron E2E 测试全部通过，包括 Node.js v24 且 npm 缺失时的准确提示。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 预览安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
