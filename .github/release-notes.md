## Windows Node.js / npm / pi 环境检测修复

修复 #12：Windows 上的 npm 和 pi 通过 `npm.cmd`、`pi.cmd` 命令 shim 提供。此前 Pi Desktop 虽然能检测到 Node.js v24，但无法可靠执行 npm；修复 npm 后，又错误地把 npm 全局包目录当作命令执行，导致 pi 已安装仍无法进入主界面。

本版本会从已定位的目录通过 Windows shell 执行 `.cmd` / `.bat` shim，兼容 `C:\Program Files\nodejs` 等包含空格的标准安装路径。应用还会根据 npm prefix 校验 `pi.cmd`，并从 `npm root -g` 下的官方包直接加载 pi SDK，不再尝试执行包目录。即使 shim 损坏或安装后 PATH 尚未刷新，只要 npm 全局包完整，应用也能正常启动。prefix 外的同名 shim 不会被执行。

Node.js 版本达标但 npm 缺失或无法运行时，引导页会显示准确的 npm 错误，不再误报 Node.js 版本。

## 验证情况

- Windows Server 2025 CI 已通过真实 `npm.cmd` 检测、Windows 标准 `pi.cmd` + npm 全局包布局回归测试和安装包 smoke build。
- macOS、Windows、Linux 均通过 TypeScript 检查、183 个单元测试、3 个 pi SDK 契约测试和安装包 smoke build。
- 107 个 Electron E2E 测试全部通过，包括全局包已安装但 pi shim 不在 PATH 时直接进入主界面的场景。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。重新发布的 v0.1.2 资产与首批同版本资产不同，请重新下载并以当前校验文件为准。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 预览安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
