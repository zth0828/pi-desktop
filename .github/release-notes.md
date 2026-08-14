## macOS “应用已损坏”修复

修复 #11：`v0.1.0` 的 macOS 应用没有完整 bundle 签名，也没有 Apple 公证票据；通过浏览器下载后带有 quarantine，Gatekeeper 因此显示“应用已损坏”。

本版本在没有 Apple Developer ID 证书时使用完整的 ad-hoc 签名，并在 DMG 中提供醒目的 `Install Pi Desktop.command`。安装脚本只处理 Pi Desktop 自身，不会关闭全局 Gatekeeper，也不要求修改“隐私与安全”设置。

### macOS 安装方法

1. 下载与你的 Mac 匹配的 DMG，并对照 `SHA256SUMS-macOS.txt` 校验文件。
2. 打开 DMG。
3. 双击 `Install Pi Desktop.command`。
4. 如果浏览器添加的 quarantine 阻止脚本双击运行：打开“终端”，输入 `bash `（末尾保留空格），把 `Install Pi Desktop.command` 拖进终端，然后按回车。
5. 脚本会验证应用、安装到 `/Applications`、仅移除 Pi Desktop 的 quarantine，并自动启动。

不要执行 `sudo spctl --master-disable`，该命令会关闭整台 Mac 对所有下载应用的 Gatekeeper。

### 验证情况

- arm64/x64 应用均通过 `codesign --verify --deep --strict`。
- DMG 均通过 `hdiutil verify`。
- 已模拟 Safari quarantine，完成“打开 DMG → 运行安装器 → 安装到 `/Applications` → 启动主进程及 Electron helper”的端到端测试。
- TypeScript 检查、180 个单元测试和目标 Electron E2E 均通过。

## 其他修复

- Sessions 页面显示所有工作区会话，并按项目分组。
- 进入历史会话时自动定位到最新消息。
- 删除、归档或重命名会话后侧栏即时同步。
- 第三方模型默认启用推理能力，并支持逐模型切换推理声明。

Pi Desktop 需要通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
