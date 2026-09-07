## 消除流式页面抽搐、主进程通信超时放宽与全链路国际化

本版本基于 `v1.3.0`，彻底消除流式输出时的消息列表频繁重新挂载与抖动，解决长任务与慢速本地模型下的主进程通信超时中断问题，并全面补齐系统托盘、运行时底层错误码与动态错误模板的双语国际化。

## 修复与改进

- **流式响应页面抽搐与视口重挂载消除（Stream Flickering Fix）**：
  - 将 `LazyMessageItem` 提取至模块顶层独立组件并使用 `React.memo` 记忆化，阻断 `ChatPane` 在 50ms 流式 flush 期间重新创建组件引用；
  - 调整可见性机制为“单向粘性可见”（进入过视口的消息保持挂载），杜绝消息在 64px 占位框与真实内容高度之间高频伸缩导致的自动滚动撕扯与列表抽搐。
- **主进程通信解耦与超时保护（Prompt IPC Non-Blocking & Timeout Relaxation）**：
  - 将 `piRuntime.prompt` 调整为在收到 pi SDK 的 `preflightResult(true)` 时立即返回成功，不再长时间同步阻塞等待整个长回合结束，彻底避免本地慢速模型或复杂长任务触发 30s 通信超时；
  - 在前端通信通道中为 `piRuntime.prompt` (120s)、`piRuntime.compact` (120s)、`piRuntime.navigateTree` (120s) 和 `piRuntime.executeBash` (300s) 配置充足的超时冗余。
- **预检异常底层错误精准透传（Preflight Error Propagation）**：
  - 优化提示词预检失败处理逻辑，允许 `session.prompt().catch` 完整捕获并向界面透传如“无可用模型”或“缺少 API Key”等详细原因，防止被通用错误码遮蔽。
- **全项目国际化与错误转译补齐（Comprehensive i18n & Error Translation）**：
  - 在错误转译层中补齐 30+ 项主进程与运行时固定错误码的双语映射；
  - 新增对模型未找到（`model not found`）、自定义供应商不存在（`custom provider not found`）、ID 重复以及更新下载失败等动态模板的参数化本地化转译；
  - 关闭错误信息插值 HTML 转义，保证模型 ID 中的斜杠正确显示；
  - 系统托盘菜单（显示主窗口 / 退出）支持跟随应用设置动态本地化，并在设置页切换语言时即时热刷新；
  - 修复聊天界面与评审面板中遗留的硬编码无障碍 aria-label。

## 验证情况

- TypeScript 严格类型检查 100% 通过（`pnpm typecheck`）。
- 全量单元测试 100% 通过（84 个测试套件，668 个单元测试全部通过）。
- Playwright Electron 端到端全量测试 100% 通过（38 个 spec，221 个 E2E 测试全部通过，8 个 Windows 专测在 macOS 环境按设计跳过）。
- 中英文字典 key 100% 对齐（`i18n-parity.test.ts` 通过）。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
