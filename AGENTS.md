# AGENTS.md — Pi Desktop

Pi Desktop 是 pi coding agent 的 Electron 桌面 GUI 壳。**壳只做体验层，能力层 100% 复用 pi 原生 SDK/CLI**。

## 铁律

1. 不在壳里重新实现任何 agent 逻辑（不自己跑 LLM、不自己管会话文件格式）。pi SDK 给什么，壳就 GUI 化什么。
2. pi 由用户环境安装（`npm i -g @earendil-works/pi-coding-agent` 是唯一支持的安装方式）。壳不打包 pi、不接管其升级。
3. pi 没有的能力通过 pi 扩展机制引入（如 pi-mcp-adapter），壳只做引导和配置 GUI。

## Renderer / Main 边界（host-api）

- 渲染层**只**通过 `window.pidesktop.hostInvoke({ id, module, action, payload })` 调后端，封装在 `src/lib/host-api-client.ts`。
- 禁止在页面/组件里直接碰 `ipcRenderer`、`window.electron` 裸调用、或直接 import pi SDK。
- Main 侧所有 pi 调用收敛在 `electron/services/`，经 `electron/main/ipc/host-invoke.ts` 的 registry 暴露。
- 新增后端能力 = 在 `shared/host-api/contract.ts` 加类型 + `electron/services/` 加实现 + preload 不动（单通道）。

## pi 事件映射单点

pi 事件 → 壳事件契约的映射**只允许**在 `shared/pi-event-map.ts`。pi 事件结构变化只改这一个文件。

## pi 路径解析

任何 pi/npm 路径必须动态获取（`npm root -g` / `npm prefix -g` / `which pi` 逐级 realpath），**禁止硬编码**。macOS 上注意 `/tmp` → `/private/tmp` 的 symlink，路径比较前两边都要 `realpathSync`。

## i18n

仅 zh / en 两个 locale，所有用户可见文案走 react-i18next，禁止硬编码字符串。新增 key 必须双语齐全（parity test 把关）。

## 测试

- UI 变更必须配 Playwright Electron E2E（fixture 模式参考 ClawX `tests/e2e/fixtures/electron.ts`，用 `PI_CODING_AGENT_DIR` 隔离用户目录）。
- pi 契约测试用 mock provider（本地 OpenAI 兼容 SSE server + models.json 自定义 provider），**不烧真实 API quota**。

## Commit 留档规范

- message 第一行说清 What，body 写 Why + 关联里程碑（如 `M2`、`spike A`）。
- 从 ClawX 移植的代码，body 注明 `Ported from ClawX: <路径>`；参考思路重写的注明 `Inspired by`。
- 一个 commit 一件事；移植类与自研类分开提交。
- 推翻文档决策时，body 引用 `docs/TECHNICAL-PLAN.md` 章节，并同步改文档（文档不入库，`docs/` 已被 gitignore）。
- 禁止 `--amend`、force push、未经确认的 rebase。

## 环境

- 本项目不依赖任何数据库/中间件/nginx 等基础设施服务。
- 本机 Node/npm 可能由各种版本管理器管理（FlyEnv/nvm/fnm/volta），路径解析见上「pi 路径解析」。
