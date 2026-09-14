### 📥 下载地址 (Download)

#### 🪟 Windows (不支持 Win7)
- **标准安装版（推荐，支持在线自动更新）**：[Windows 64位安装包 (.exe)](https://github.com/zth0828/pi-desktop/releases/download/v1.4.2/Pi.Desktop-Setup-1.4.2-x64.exe)

#### 🍏 macOS (macOS 11.0+)
- **Apple M芯片（M1 / M2 / M3 / M4 系列）**：[Apple M芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.2/Pi.Desktop-1.4.2-arm64.dmg)
- **Intel芯片（老款 Intel 处理器 Mac）**：[Intel芯片 DMG 安装镜像](https://github.com/zth0828/pi-desktop/releases/download/v1.4.2/Pi.Desktop-1.4.2-x64.dmg)

> [!TIP]
> **macOS 首次打开若提示“已损坏，无法打开”**：  
> 由于开源预览版未接入 Apple 开发者证书签名公证，首次拖入「应用程序」后若被系统 Gatekeeper 拦截，请打开系统终端（Terminal）执行以下命令解除隔离：  
> ```bash
> sudo xattr -rd com.apple.quarantine "/Applications/Pi Desktop.app"
> ```

---

## 轻量级 3.9MB 增量补丁秒级热更新、Asar 依赖体积剪枝与双语文档优化

本版本基于 `v1.4.1`，核心实现**轻量级 Asar 增量补丁秒级自动更新（Lightweight Asar Patch Auto-Update）**，将日常版本迭代下载体积由全量 ~176MB 大幅骤减至 ~3.9MB，实现客户端秒级下载与丝滑原地重启；并完成双语 README 结构优化与 macOS 首次启动隔离放行引导。

## 核心特性与改进

- **轻量级 Asar 增量补丁秒级热更新（Lightweight Patch Auto-Update）**：
  - **依赖深度剪枝**：将前端纯渲染依赖移至 `devDependencies`（已由 Vite 编译内联），消除打包时冗余的 299MB `node_modules`，`app.asar` 体积由 253MB 直降至 17MB（缩减 93%）；
  - **3.9MB 极小补丁**：CI 发布流程自动打包提取纯代码与主进程资产生成 `Pi.Desktop-${version}-patch.zip`，压缩后仅 3.92MB（相比 176MB 全量包缩小约 45 倍）；
  - **客户端智能首选**：客户端更新检查默认优先匹配 `*-patch.zip` 增量补丁，下载后自动解压验证内含 `patch-metadata.json` 的 SHA-256 完整性；
  - **macOS 本地重签名**：原地替换 `Resources/app.asar` 后自动执行 Ad-hoc 代码重签名（`codesign --force --deep --sign -`），确保替换后系统安全机制（Gatekeeper / AMFI）正常放行并自动重启；
  - **Windows 句柄等待替换**：通过独立的后台批处理重试脚本等待旧进程完全释放句柄后静默替换并拉起新版；
  - **可靠全量兜底**：若增量补丁解压失败或暂存异常，平滑回退至全量安装包流程，确保更新体验 100% 可靠。
- **文档与发版体验优化**：
  - 默认 `README.md` 调整为中文主导，英文版本归档至 `README.en.md`；
  - 补充 macOS Gatekeeper 隔离放行一键执行命令，降低新用户首次打开门槛。

## 验证情况

- TypeScript 严格类型检查 100% 通过（`pnpm typecheck`）。
- 全量单元测试 100% 通过（91 个测试套件，740 项单元测试全部通过，含补丁选择与全量回退用例）。
- Playwright Electron 端到端全量测试通过（包含检查更新 -> 下载 3.9MB 补丁 -> 自动解压校验 -> 暂存配置落盘 -> 重启安装对话框全流程）。
- 打包应用 Smoke 测试通过（1.9s 快速启动并成功连接 SDK）。

## 安装与升级提示

Pi Desktop 需要 Node.js 22.19.0 或更新版本，并要求通过 npm 全局安装兼容版本的 pi：

```bash
npm i -g @earendil-works/pi-coding-agent
```

- **全新安装**：根据操作系统与芯片类型下载上方 DMG 或 EXE 安装包；
- **后续更新**：从本版本起，后续新版本检测到更新时将在应用内自动优先下载 ~3.9MB 极小增量补丁包，一键秒级更新重启生效！

本软件可免费用于个人和非商业用途；商业使用需事先获得书面授权，详见 LICENSE。
