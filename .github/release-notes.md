## 拖拽引导、Skills 导入与体验修复

本版本是多窗口/分栏之后的一批体验优化与问题修复。

- **拖拽引导**：拖会话时顶部出现操作提示（拖到面板边缘分栏 / 中心替换 / 拖出窗口打开独立窗口 / Esc 取消）；悬停到面板上时，落区中心会实时显示松手后的具体操作（如「松手在右侧分栏」「松手替换当前面板会话」）。
- **Skills 页增强**：点击「查看内容」可直接阅读 skill 的 SKILL.md；新增「导入」，可扫描 Claude（`~/.claude/skills`）、Codex（`~/.codex/skills`）的 skills 目录或手动选择目录，复制导入（非链接）；同名 skill 会标注「已存在/同名冲突」，冲突可选择跳过、覆盖或保留两者。
- **独立窗口打开更快**：打开独立窗口时会话运行时与页面加载并行准备，会话多的情况下提速更明显。
- **会话页改版**：卡片改为标题 + 元信息两行层级，重命名/分叉/导出/归档/删除收在右侧，悬停时显现。
- **会话标题修复**：带图片/文件附件的会话，标题不再显示 `<attachments>` 标记，以消息文字为主（历史会话一并生效）。
- **其他修复**：拖出会话途中按 Esc 不再误开独立窗口；拖拽提示偶发残留修复；路径比较为 Windows 大小写不敏感与分隔符差异做了平台化准备。

## 验证情况

- macOS：263 个单元测试、3 个 pi SDK 契约测试、Electron E2E 全部通过（含多面板、多窗口、会话、Skills 场景）。
- Windows、Linux：通过 TypeScript 检查、单元测试、契约测试和安装包 smoke build。**多窗口与分栏功能尚未在 Windows 实机调试**，如遇拖拽落点、窗口行为异常请提 Issue。
- 发布产物附带按平台生成的 `SHA256SUMS-<platform>.txt`。

## 安装提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

Windows 和 Linux 预览安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。请只从本仓库 GitHub Releases 下载，并在运行前核对 SHA-256。

没有 Apple Developer ID 凭据时，macOS 产物使用完整的 ad-hoc 签名。打开 DMG 后双击 `Install Pi Desktop.command`；如果浏览器 quarantine 阻止双击，请在终端中运行该安装器。安装器只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper。

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
