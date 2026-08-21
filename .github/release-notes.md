## 跨平台窗口体验、系统托盘与本地模型连接修复

本版本基于 `v0.3.0`，主要带来跨平台窗口体验统一（系统托盘、Windows 无边框窗口、macOS 原生菜单栏）、本地 LLM 连接可靠性提升与工作区安全加固。

## 新功能

- **系统托盘与关闭到托盘（Windows/Linux）**：主窗口关闭后最小化到系统托盘，可随时恢复或退出；托盘图标按平台使用正确格式。
- **Windows 无边框窗口**：双行窗口 chrome + 菜单栏，消除旧版空白窗口与重复实例卡启动问题；小屏幕 workArea 自动适配窗口尺寸。
- **跨平台统一布局**：顶部 chrome 与侧栏布局在 macOS/Windows/Linux 上保持一致。
- **macOS 原生菜单栏**：traffic-light 侧边控件、与 Windows 菜单栏对齐的结构与标签、本地化菜单（含 Select All）、顶部固定会话标题栏；开发时自动生成 Pi Desktop dev bundle。
- **工作区信息展示**：composer 显示当前工作区的 git 分支，移除 untitled 会话占位。
- **错误体验优化**：失败 turn 折叠为紧凑错误结果；provider 聊天错误分类并显示归属提示（API key / 网络 / 服务端）。

## 修复

- **本地 LLM 连接**：loopback 请求绕过系统代理（本地模型探测不再 502），probe catalog 失败显性化而不静默返回空模型，LM Studio 仅暴露原生 endpoint 时回退 `/v1` base；无 key 的本地服务器可直接使用，reasoning 可按服务器独立控制。
- **工作区安全护栏**：主目录与盘符根不能作为 pi 工作区；删除会话时全程留痕，无 runtime 使用时清理空目录。
- **输入与补全**：`@`-补全的 fallback 遍历尊重 `.gitignore`（fd 不可用时）。
- **消息队列**：会话 idle 时正确交付排队中的 send-now 消息。
- **provider 探测**：custom provider probe 拆分为仅列表 + 可选协议校验，覆盖更多上游错误形状。

## 性能与测试

- 延迟 pi SDK 兼容性探测、缓存环境检测并复用 warm adapter，加速启动。
- Electron E2E 覆盖 Windows，并行化 worker 并加入 pi prefix 安装锁与失败重试。
- 新增单测与 E2E：托盘行为、窗口 chrome、原生菜单、队列交付、工作区安全、git 分支展示、gitignore 遍历、provider 错误分类、LM Studio 模型发现、窗口尺寸边界等。

## 验证情况

- 本地通过 TypeScript 检查、单元测试（360 通过）与生产构建。
- CI 在 macOS、Windows、Linux 上分别执行类型检查、单元测试、Vite 构建与安装包构建，全绿。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
