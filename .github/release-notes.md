### 📥 下载地址 (Download)

#### 🪟 Windows (不支持 Win7)
- **标准安装版（推荐，支持在线自动更新）**：[Windows 64位安装包 (.exe)](https://github.com/zth0828/pi-desktop/releases/download/v1.4.4/Pi.Desktop-Setup-1.4.4-x64.exe)

> [!TIP]
> **Windows v1.4.3 用户升级说明**：  
> 由于 v1.4.3 初版热更新机制受 Windows 权限限制，请下载上方本次发布的安装包（.exe）覆盖安装一次。本次安装包已切换为免提权的用户目录安装，从当前版本（v1.4.4）起，后续所有更新均全面支持应用内一键秒级热更新，无需再手动下载安装包！

#### 🍏 macOS (macOS 11.0+)
- **Apple M芯片（M1 / M2 / M3 / M4 系列）**：[Apple M芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.4/Pi.Desktop-1.4.4-arm64.dmg)
- **Intel芯片（老款 Intel 处理器 Mac）**：[Intel芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.4/Pi.Desktop-1.4.4-x64.dmg)

> [!TIP]
> **macOS 首次打开若提示“已损坏，无法打开”**：  
> 由于开源预览版未接入 Apple 开发者证书签名公证，首次拖入「应用程序」后若被系统 Gatekeeper 拦截，请打开系统终端（Terminal）执行以下命令解除隔离：  
> ```bash
> sudo xattr -rd com.apple.quarantine "/Applications/Pi Desktop.app"
> ```

---

## 跨平台增量热更新在线闭环、子进程静默运行、安装权限优化与更新弹窗布局重构

本版本基于 `v1.4.3`，核心引入**双端在线增量热更新（Hot Update）体验闭环与鲁棒性加固、子进程静默无弹窗运行、安装包权限与结构优化、更新弹窗布局重构与 Release Notes 智能清洗**。从本版本开始，用户无需频繁下载几十兆的完整安装包，检测到新版本后应用内即可一键秒级下载极小的增量补丁（~3.9MB）并自动平滑重启生效！

## 核心特性与改进

- **跨平台在线增量热更新（Hot Update）闭环与加固**：
  - **增量补丁自适应识别与操作**：更新就绪后自动检测 `.patch.zip` 补丁类型，动态展示补丁专属文案与『重启并应用更新』操作，支持一键秒级更新；
  - **Windows 终端静默调用层**：在 Windows 11 下通过 WScript.Shell 隐式调用批处理，彻底阻断系统默认终端（Windows Terminal）的黑框弹窗拦截；
  - **子进程控制台黑框消除**：为 Git 及各类执行命令子进程注入 `windowsHide` 与 `CREATE_NO_WINDOW` 标志，杜绝任何闪烁与黑框干扰；
  - **批处理稳定性重构**：采用稳健的 ping 延时机制与平铺式批处理结构，精准等待旧进程 PID 完全释放后再覆盖核心资源，杜绝语法解析异常；
  - **安装路径权限优化**：NSIS 安装器默认切换为当前用户目录安装（`perMachine: false`），免除写入 Program Files 的管理员提权限制；并增加 UAC 写入权限检测与补丁调试日志兜底；
  - **重启生命周期保护**：主进程在退出中状态下忽略二次唤起请求，避免进程更新替换时的单例锁竞争。
- **更新交互弹窗重构与 Release Notes 智能清洗**：
  - **更新弹窗排版与防折行**：弹窗宽度拓宽至 560px，底部操作栏采用左右分流结构（『跳过此版本』靠左，其余靠右），强制单行不折行；
  - **文件资产卡片化**：替换生硬的文件名输入框，升级为具备专属图标与『增量补丁』高亮徽标的资产展示卡片；
  - **Release Notes 智能清洗**：自动剥离 GitHub 网页专用的下载专区与安装包列表，弹窗内直观呈现纯粹的版本新特性与变更日志；
  - **版本欢迎弹窗体验优化**：大幅提升版本升级成功后的欢迎说明弹窗滚动视口高度并引入沉浸式卡片容器，清晰直观。
- **开发与离线测试支持**：
  - 新增本地 Mock 更新测试服务脚本，支持在开发阶段离线走查全流程在线更新与版本跨越提醒。

## 验证情况

- TypeScript 严格类型检查 100% 通过（`pnpm typecheck`）。
- 全量单元测试 100% 通过（98 个测试套件，768 项单元测试全部通过）。
- SDK 契约测试 100% 通过（`pnpm test:contract`）。
- 中英文字典 key 100% 对齐（`i18n-parity.test.ts` 通过）。
- Windows 11 & macOS 增量热更新全流程实机验证通过。

## 安装与升级提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

- **全新安装**：根据操作系统与芯片类型下载上方 DMG 或 EXE 安装包；
- **后续更新**：从 v1.4.4 开始，检测到新版本时将在应用内自动优先下载极小增量补丁包，一键秒级更新重启生效！

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
