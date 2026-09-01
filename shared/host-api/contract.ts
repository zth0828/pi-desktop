/**
 * Host API contract — the single source of truth for Renderer↔Main calls.
 * Renderer 只允许通过这里声明的 module.action 调后端。
 */
export type JsonRecord = Record<string, unknown>;
export type HostSuccess = { success: boolean; error?: string };

export type ShellOpenExternalPayload = { url: string };

export type ShellApplication = {
  id: string;
  name: string;
  path: string;
  /** OS-provided application icon. Optional in headless and unsupported environments. */
  iconDataUrl?: string;
};

export type ShellListApplicationsResult = {
  applications: ShellApplication[];
};

export type ShellOpenPathWithPayload = {
  path: string;
  application: ShellApplication;
};
export type ShellOpenPathPayload = { path: string };
export type AppClipboardWritePayload = { text: string };
export type AppClipboardImagePayload = {
  /** Base64-encoded image data (without data: URL prefix) */
  data: string;
  mimeType?: string;
};
export type AppWriteBinaryFilePayload = {
  path: string;
  /** Base64-encoded binary file content */
  data: string;
};
export type AppEditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';
export type AppEditCommandPayload = {
  command: AppEditCommand;
};

// —— piSystem：pi/Node/npm 环境检测与安装引导 ——

export type PiInstallKind = 'npm' | 'non-npm';

export type NodeDetectResult = {
  found: boolean;
  path?: string;
  version?: string;
  meetsMin: boolean;
};

export type NpmDetectResult = {
  found: boolean;
  path?: string;
  version?: string;
  /** realpath 后的 npm 全局 root（…/lib/node_modules） */
  globalRoot?: string;
};

export type PiCapabilities = {
  createAgentSessionServices: boolean;
  createAgentSessionFromServices: boolean;
  createAgentSessionRuntime: boolean;
  sessionManager: boolean;
  settingsManager: boolean;
  eventBus: boolean;
  prompt: boolean;
  subscribe: boolean;
  abort: boolean;
};

export type PiCapabilityState = 'available' | 'missing' | 'not-checked' | 'failed';
export type PiCapabilityReport = {
  module: Record<string, PiCapabilityState>;
  session: Record<string, PiCapabilityState>;
  optional: Record<string, PiCapabilityState>;
};
export type PiCompatibilityFailureCode =
  | 'not-installed'
  | 'non-npm-install'
  | 'version-too-low'
  | 'entry-not-found'
  | 'module-import-failed'
  | 'missing-public-export'
  | 'missing-session-capability'
  | 'optional-feature-unavailable'
  | 'restart-required';
export type PiCompatibilityStatus = 'tested' | 'compatible-untested' | 'incompatible' | 'restart-required';

export type PiCompatibilityReport = {
  status: PiCompatibilityStatus;
  version: string;
  packageRoot: string;
  cliPath?: string;
  cliVersion?: string;
  nodePath?: string;
  nodeVersion?: string;
  npmPath?: string;
  npmVersion?: string;
  npmRoot?: string;
  missingRequiredCapabilities: string[];
  optionalCapabilities: Record<string, boolean>;
  capabilities: PiCapabilities;
  capabilityReport?: PiCapabilityReport;
  failureCode?: PiCompatibilityFailureCode;
  failureDetail?: string;
  generation?: string;
  testedRange: boolean;
  recommendedVersion: string;
  warnings: string[];
};

export type PiDetectResult = {
  found: boolean;
  binPath?: string;
  realBinPath?: string;
  packageRoot?: string;
  version?: string;
  cliVersion?: string;
  installKind?: PiInstallKind;
  meetsMin: boolean;
  /** 仅开发启动脚本可设置：显式使用用户指定的本地 pi 包。 */
  devOverride?: boolean;
  /** 仅开发启动脚本可设置：允许加载低于最低兼容版本的 pi。 */
  devAllowsOutdated?: boolean;
  /** npm root 下装着 pi 但 PATH 里的 pi 指向别处（PATH 遮蔽）时给出 */
  npmInstalledVersion?: string;
};

export type PiEnvironment = {
  node: NodeDetectResult;
  npm: NpmDetectResult;
  pi: PiDetectResult;
  minNodeVersion: string;
  minPiVersion: string;
  /** Filled by Main after loading the SDK; absent when pi is not installed. */
  compatibility?: PiCompatibilityReport;
};

export type PiLatestVersionResult = {
  latest?: string;
  checkedAt: number;
};

export type VersionCheckStatus = {
  current?: string;
  latest?: string;
  updateAvailable: boolean;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  error?: string;
};

export type VersionCheckSnapshot = {
  pi: VersionCheckStatus;
  app: VersionCheckStatus & {
    releaseUrl?: string;
    releaseNotes?: string;
    assetName?: string;
    downloadedPath?: string;
  };
};

/** 待展示的版本更新通知（kind 区分 app 自身与 pi）。 */
export type VersionCheckPendingNotice = {
  current: string;
  latest: string;
  releaseUrl?: string;
  kind: 'app' | 'pi';
};

export type AppUpdateDownloadResult = HostSuccess & {
  path?: string;
  assetName?: string;
};

export type AppUpdateProgressEvent = {
  phase: 'started' | 'progress' | 'completed' | 'failed';
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  path?: string;
  error?: string;
};

export type PiInstallResult = HostSuccess & {
  version?: string;
};

// 未从供应商目录返回上下文长度时，统一使用 256K，避免不同入口出现不同默认值。
export const DEFAULT_CONTEXT_WINDOW = 262_144;

// —— piRuntime：SDK 会话运行时 ——

export type PiRuntimeStartPayload = { cwd: string };
/**
 * behavior：流式中提交的排队方式（pi streamingBehavior）。
 * 'followUp'（默认）= 排队等当前 run 完成后发送；'steer' = 当前轮工具调用间隙插入。
 */
export type PiRuntimePromptPayload = {
  text: string;
  images?: unknown[];
  behavior?: 'steer' | 'followUp';
};
export type PiPromptLifecyclePhase = 'submitted' | 'accepted' | 'started' | 'finished' | 'failed';
export type PiPromptLifecycleEvent = {
  phase: PiPromptLifecyclePhase;
  requestId: string;
  runtimeId: string;
  sessionId: string;
  generation: number;
  adapterGeneration?: string;
  error?: string;
};

// —— piRuntime 排队消息操作（steer/followUp 队列；pi 只有 clearQueue 全清，单条移除=快照后重排）——

export type PiRuntimeQueueKind = 'steering' | 'followUp';
export type PiRuntimeQueueItemPayload = { kind: PiRuntimeQueueKind; index: number };
export type PiRuntimeQueueMovePayload = PiRuntimeQueueItemPayload & { target: PiRuntimeQueueKind };
export type PiRuntimeQueueMutationResult = HostSuccess & { text?: string };
export type PiRuntimeAbortResult = HostSuccess & { restoredMessages?: string[] };

export type PiRuntimeModelInfo = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  /** 输入模态：含 'image' 表示支持图像输入（多模态）。 */
  input?: string[];
  contextWindow?: number;
  /** Maximum generated tokens for one response. This is not the context window. */
  maxTokens?: number;
};

export type PiRuntimeContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  /** pi 没有可用 usage 时由 SDK estimator 计算的近似值。 */
  estimated?: boolean;
};

export type PiRuntimeUsageTurn = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  provider?: string;
  model?: string;
};

/** Active context is model-scoped; totals are canonical whole-session pi stats. */
export type PiRuntimeUsageResult = {
  context: PiRuntimeContextUsage | null;
  model?: PiRuntimeModelInfo;
  session: PiRuntimeUsageTurn;
  latestTurn: PiRuntimeUsageTurn | null;
};

export type PiRuntimeModelUpdateResult = HostSuccess & {
  model?: PiRuntimeModelInfo;
  thinkingLevel?: string;
  availableThinkingLevels?: string[];
  contextUsage?: PiRuntimeContextUsage;
};

export type PiRuntimeStateResult = {
  sessionId: string;
  cwd: string;
  generation: number;
  model?: PiRuntimeModelInfo;
  thinkingLevel: string;
  availableThinkingLevels: string[];
  isStreaming: boolean;
  /** Main-maintained run state covers providers that lag isStreaming during resume. */
  running?: boolean;
  /** 当前 pi 上下文中的 AgentMessage[]，用于运行时增量更新。 */
  messages: unknown[];
  /**
   * 当前分支的完整展示历史。上下文压缩后 pi 的 messages 会只保留摘要和尾部，
   * 但 session entry 仍保留完整历史；渲染层用这个字段恢复可定位的完整对话。
   */
  historyMessages?: unknown[];
  /**
   * 与 messages 平行的会话 entry id（仅 user 消息 entry 有值，其余为 null）。
   * pi 的 AgentMessage 本身不带 entryId；这里按 buildSessionContext 的
   * flatMap(sessionEntryToContextMessages) 对齐重建，供消息级 fork 使用。
   */
  messageEntryIds: (string | null)[];
  /** 与 historyMessages 平行的完整分支 entry id。 */
  historyMessageEntryIds?: (string | null)[];
  sessionFile?: string;
  contextUsage?: PiRuntimeContextUsage;
  /** pi branchSummary.skipPrompt 设置：true 时跳分支默认不询问摘要（TUI 同款语义）。 */
  branchSummarySkipPrompt?: boolean;
  extensionUi?: PiExtensionUiState;
  /** 后台 runtime 等待中的扩展确认；切回会话时恢复对话框。 */
  pendingUiRequests?: PiUiRequestPayload[];
  /** 删除会话驱动的替换：被删会话的原 sessionId，供正在查看它的面板认领新会话。 */
  replacesSessionId?: string;
  /**
   * 渲染层发起的替换动作 id（newSession/fork 请求携带、main 原样回显）：
   * 同窗口多面板并发替换时，各面板只应用自己发起的那次事件，防止面板劫持。
   */
  replacementActionId?: string;
};

// —— piRuntime 消息级 fork / 分支导航（/tree）——

export type PiRuntimeForkPayload = { entryId: string; actionId?: string };
/** newSession 请求载荷：actionId 供 sessionReplaced 事件回显发起上下文。 */
export type PiRuntimeNewSessionPayload = { actionId?: string };
export type PiRuntimeForkResult = HostSuccess & {
  /** position='before' 语义：被选中 user 消息的文本（回填输入框供编辑重发） */
  selectedText?: string;
};

export type PiRuntimeTreeNode = {
  id: string;
  /** 视觉缩进深度（结构噪音 entry 被跳过，子节点继承其深度） */
  depth: number;
  kind: 'user' | 'assistant' | 'other';
  /** 节点摘要文本（已折叠空白并截断） */
  text: string;
  label?: string;
  isLeaf: boolean;
  onCurrentPath: boolean;
};
export type PiRuntimeTreeResult = { nodes: PiRuntimeTreeNode[] };
export type PiRuntimeNavigatePayload = {
  targetId: string;
  /** 离开当前分支前是否先摘要被弃分支（TUI 跳分支询问的 summarize 选项）。 */
  summarize?: boolean;
  /** summarize 的自定义摘要指令（TUI 的 "Summarize with custom prompt"）。 */
  customInstructions?: string;
};
export type PiRuntimeNavigateResult = HostSuccess & {
  /** 目标是 user 消息时 pi 把文本退回编辑器（TUI /tree 语义） */
  editorText?: string;
  /** 摘要进行中被打断（abortBranchSummary）：TUI 此时重新打开分支树。 */
  aborted?: boolean;
};

// —— piRuntime 斜杠命令配套（TUI onSubmit 内建命令的壳映射）——

/** /compact <instructions>：pi handleCompactCommand 的自定义压缩指令 */
export type PiRuntimeCompactPayload = { customInstructions?: string };
/** `!cmd` bash 执行（pi executeBash；`!!` 前缀 = excludeFromContext 不入上下文）。 */
export type PiRuntimeBashPayload = { command: string; excludeFromContext?: boolean };
/** /export [path]：pi handleExportCommand（缺省导到会话同目录 HTML） */
export type PiRuntimeExportPayload = { outputPath?: string };

/** /session 展示的会话信息（pi getSessionStats + sessionName 的子集） */
export type PiRuntimeSessionInfo = {
  name?: string;
  sessionId: string;
  sessionFile?: string;
  isSaved?: boolean;
  model?: PiRuntimeModelInfo;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
};

// —— piRuntime 扩展 UI 桥（ctx.ui.confirm/select/input → 渲染层对话框）——

export type PiUiRequestKind = 'confirm' | 'select' | 'input' | 'editor';

export type PiExtensionUiWidget = {
  key: string;
  lines: string[];
  placement: 'aboveEditor' | 'belowEditor';
};

export type PiExtensionUiState = {
  sessionId: string;
  generation: number;
  statuses: Array<{ key: string; text: string }>;
  widgets: PiExtensionUiWidget[];
  workingMessage?: string;
  workingVisible: boolean;
  hiddenThinkingLabel?: string;
};

export type PiExtensionUiNotification = {
  sessionId: string;
  generation: number;
  message: string;
  level: 'info' | 'warning' | 'error';
  /** unsupportedTui：message 是 TUI 专属能力名，渲染层按 i18n 模板本地化 */
  kind?: 'unsupportedTui';
};

export type PiUiRequestPayload = {
  /** 请求 id：响应按它配对，迟到/过期响应幂等忽略 */
  requestId: string;
  sessionId: string;
  /** 会话 generation：会话替换后的渲染层据此丢弃过期请求 */
  generation: number;
  kind: PiUiRequestKind;
  title: string;
  /** confirm 的正文 */
  message?: string;
  /** select 的选项列表 */
  options?: string[];
  /** input 的占位符 */
  placeholder?: string;
  /** editor 的初始多行文本 */
  prefill?: string;
  /** 扩展传入的超时（ExtensionUIDialogOptions.timeout），到期 main 侧按取消兜底 */
  timeoutMs?: number;
};

export type PiUiResponsePayload = {
  requestId: string;
  /** confirm=boolean；select/input=用户文本；取消/超时/会话替换时缺省 */
  value?: string | boolean;
  cancelled?: boolean;
};

// —— review：Git HEAD / 非 Git 会话 baseline diff ——

export type ReviewFileStatus = 'modified' | 'added' | 'deleted' | 'conflicted';

export type ReviewFileEntry = {
  /** 相对 cwd 的路径 */
  path: string;
  status: ReviewFileStatus;
  added: number;
  deleted: number;
};

export type ReviewSummaryResult = {
  /** baseline 评审是否可用（Git 与非 Git 工作区都支持） */
  available: boolean;
  /** 不可用原因：not-started / not-a-git-repo / git-error:<msg> */
  reason?: string;
  files: ReviewFileEntry[];
};

export type ReviewFileDiffPayload = { path: string };
export type ReviewFileDiffResult = {
  available: boolean;
  reason?: string;
  path: string;
  /** 标准 unified diff（baseline tree ↔ 当前磁盘快照），空串 = 无差异 */
  diff: string;
};

export type ReviewRevertFilePayload = { path: string };
/** hunk 级回滚：渲染层把 diff 解析成 hunk、重建只含该 hunk 的合法 unified diff，main 侧 git apply -R */
export type ReviewRevertHunkPayload = { path: string; patch: string };

// —— workspace：活动 runtime cwd 内的安全文件浏览与预览 ——

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
};
export type WorkspaceListPayload = { path?: string };
export type WorkspaceListResult = { path: string; entries: WorkspaceEntry[] };

/** 当前工作区 git 分支（pi TUI footer 同口径；非仓库返回 branch: null）。 */
export type GitBranchResult = { branch: string | null };
export type GitBranchListResult = {
  branches: string[];
  current: string | null;
  isDirty: boolean;
};
export type GitCheckoutResult = {
  success: boolean;
  error?: 'dirty' | 'running' | string;
  branch?: string;
};
export type WorkspaceReadPayload = { path: string };
export type WorkspaceReadResult = {
  path: string;
  /** Main 侧已在活动工作区边界内解析并校验的真实路径，仅用于系统打开/显示。 */
  absolutePath: string;
  name: string;
  size: number;
  kind: 'text' | 'markdown' | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'binary';
  mimeType?: string;
  text?: string;
  data?: string;
  truncated: boolean;
};

// —— settings：壳自身设置（electron-store 持久化）——

/** 默认由 Pi Desktop 管理的本地代理地址。 */
export const DEFAULT_DESKTOP_PROXY_URL = 'http://127.0.0.1:7897';

/** 默认公共 GitHub 下载加速镜像前缀。 */
export const DEFAULT_DOWNLOAD_MIRROR = 'https://ghproxy.net/';

/** 网络代理模式：auto=启用 Pi Desktop 中配置的代理地址（默认），off=直连。 */
export type ProxyMode = 'auto' | 'off';

/** 代理状态：当前模式 + Pi Desktop 中实际生效的代理地址。 */
export type ProxyDetection = {
  mode: ProxyMode;
  /** 当前实际生效的代理 URL；关闭代理时无值。 */
  url?: string;
  /** 来源：app=Pi Desktop 设置，off=主动关闭。 */
  source?: 'app' | 'off';
};

export type ProxyApplyResult = HostSuccess & { detail?: string };

export type SettingsSnapshot = {
  language?: 'zh' | 'en';
  workspaceCwd?: string;
  theme?: 'light' | 'dark' | 'system';
  /** 系统通知档位：always=总是，unfocused=仅窗口失焦（默认），off=关闭 */
  notifyMode?: 'always' | 'unfocused' | 'off';
  /** 流式中提交的默认跟进方式：queue=排队等当前 run 完成（默认），steer=当前轮插入；Alt+Enter 始终反向 */
  followupBehavior?: 'queue' | 'steer';
  /** 扩展 UI 请求（确认/输入）是否弹系统通知（默认 true）；run 完成通知仍走 notifyMode 档位 */
  notifyUiRequest?: boolean;
  /** agent 运行期间阻止显示器/系统休眠（含自动重试等待；默认 false） */
  preventSleep?: boolean;
  /** 发送快捷键：enter=Enter 发送（默认），cmdEnter=Cmd/Ctrl+Enter 发送、Enter 换行 */
  sendWith?: 'enter' | 'cmdEnter';
  /** 最近一次成功导出的会话 HTML；用于跨页面/重启恢复打开入口。 */
  lastSessionExportPath?: string;
  /** 网络代理模式（默认 auto：启用 Pi Desktop 配置的代理地址）。 */
  httpProxyMode?: ProxyMode;
  /** Pi Desktop 使用的代理 URL；缺省为 DEFAULT_DESKTOP_PROXY_URL。 */
  httpProxyUrl?: string;
  piVersionCheckLastAttemptAt?: number;
  piVersionCheckLastSuccessAt?: number;
  piVersionCheckLatest?: string;
  piVersionCheckError?: string;
  appVersionCheckLastAttemptAt?: number;
  appVersionCheckLastSuccessAt?: number;
  appVersionCheckLatest?: string;
  appVersionCheckError?: string;
  appVersionCheckReleaseUrl?: string;
  appVersionCheckReleaseNotes?: string;
  appVersionCheckAssetName?: string;
  appVersionCheckDownloadedPath?: string;
  appVersionCheckNoticedLatest?: string;
  appVersionCheckNoticedAt?: number;
  piVersionCheckNoticedLatest?: string;
  piVersionCheckNoticedAt?: number;
  downloadMirror?: string;
};

export type SettingsGetPayload = { key: keyof SettingsSnapshot };
export type SettingsSetPayload = { key: keyof SettingsSnapshot; value: string | number | boolean | undefined };

// —— piTrust：项目信任（pi ProjectTrustStore；判定逻辑全在 pi 侧）——

/** 信任确认请求：title/options 来自 pi 原生文案（英文），渲染层按模板本地化展示。 */
export type PiTrustRequestPayload = {
  requestId: string;
  cwd: string;
  title: string;
  options: string[];
};
export type PiTrustRespondPayload = { requestId: string; label?: string };
export type PiTrustEntry = { path: string; decision: boolean };
export type PiTrustListResult = { entries: PiTrustEntry[] };
/** decision=null 撤销记录（下次启动该 cwd 重新询问）。 */
export type PiTrustSetPayload = { path: string; decision: boolean | null };

// —— dialog：系统对话框 ——

export type DialogOpenPayload = {
  title?: string;
  defaultPath?: string;
  properties?: Array<'openFile' | 'openDirectory' | 'createDirectory'>;
};
export type DialogOpenResult = { canceled: boolean; filePaths: string[] };

export type DialogSavePayload = {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};
export type DialogSaveResult = { canceled: boolean; filePath?: string };

// —— windows：多窗口管理 ——

export type WindowsOpenDetachedPayload = { sessionPath: string; cwd?: string };
/** 拖出开窗：screenX/screenY 为松手点屏幕 DIP 坐标（渲染层 dragend 原样上报）。 */
export type WindowsOpenDetachedAtPayload = WindowsOpenDetachedPayload & {
  screenX: number;
  screenY: number;
};
export type WindowsFocusPayload = { sessionPath: string };
/** 当前窗口内所有面板占用的会话，用于窗口级路由和生命周期同步。 */
export type WindowsSetSessionsPayload = {
  sessionPaths: string[];
  activeSessionPath?: string;
};
export type WindowListEntry = {
  windowId: number;
  sessionPath: string | null;
  isMain: boolean;
  focused: boolean;
};
/** 工作台 docked 展开时请求窗口向右加宽的像素数。 */
export type WindowsExpandRightPayload = { extraWidth: number };
/** 实际加宽像素（受屏幕右缘可用空间约束，可能小于请求值；无空间/最大化时为 0）。 */
export type WindowsExpandRightResult = { applied: number };

// —— notify：macOS 系统通知（渲染层只上报事件，焦点判定与弹通知都在 main）——

export type NotifyKind = 'runCompleted' | 'uiRequest';
export type NotifyDispatchPayload = {
  kind: NotifyKind;
  /** 已在渲染层本地化的标题/正文 */
  title: string;
  body?: string;
  /** 产生通知的会话文件路径：main 按它定位焦点判定与点击目标；in-memory 会话暂无文件，缺省回退窗口级判定 */
  sessionPath?: string;
};

// —— providers：模型/供应商管理 ——

export type PiProviderRow = {
  id: string;
  name: string;
  /** 供应商 API 请求地址（内置来自 pi catalog，自定义来自 models.json baseUrl）。 */
  baseUrl?: string;
  /** 请求协议（自定义供应商来自 models.json api；内置供应商缺省）。 */
  api?: string;
  source: 'builtin' | 'config' | 'extension';
  authMethods: string[];
  configured: boolean;
  modelCount: number;
};
export type PiProviderListResult = { providers: PiProviderRow[] };
export type PiProviderSetKeyPayload = { providerId: string; apiKey: string };
export type PiProviderSetKeyResult = HostSuccess & {
  discoveredModels?: number;
  addedModels?: number;
  discoveryError?: string;
};
export type PiModelRow = {
  provider: string;
  providerLabel?: string;
  id: string;
  name?: string;
  api: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};
export type PiProviderRefreshResult = HostSuccess & {
  aborted?: boolean;
  errors?: string[];
  discoveredModels?: number;
  addedModels?: number;
  migratedProviders?: number;
};
/** 探测到的自定义服务器类型：决定 models.json 写库时的思考控制兼容配置。 */
export type PiProviderServerType = 'lm-studio' | 'vllm' | 'generic';

export type PiProviderAddCustomPayload = {
  id: string;
  /** 展示名：写入 models.json providers.<id>.name，pi 会将其作为供应商名返回。 */
  name: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
  /** 探测结果（probe.serverType）；未探测时由 main 按 baseUrl/ID 回退判定。 */
  serverType?: PiProviderServerType;
  models: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    /** 输入模态（多模态识别）：探测目录上报时传入；缺省由后端按规格表判定。 */
    input?: Array<'text' | 'image'>;
    contextWindow?: number;
    maxTokens?: number;
    thinkingLevelMap?: Record<string, string | null>;
  }>;
};
/** 编辑自定义供应商基本信息（名称/baseUrl/请求协议）；模型与凭证保持不变。 */
export type PiProviderUpdateCustomPayload = {
  providerId: string;
  name?: string;
  baseUrl?: string;
  api?: string;
};
export type PiProviderProbePayload = {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  /** true = 对每个候选协议发送一次最小化生成请求（约 1 token）做真实验证；缺省只拉模型目录，不发生成请求。 */
  verifyProtocols?: boolean;
};
/** 切换 models.json 自定义模型的推理能力声明（决定思考深度菜单是否可用）。 */
export type PiProviderSetModelReasoningPayload = {
  providerId: string;
  modelId: string;
  reasoning: boolean;
};
/** 切换 models.json 自定义模型的图像输入声明（多模态识别，决定图片附件是否可用）。 */
export type PiProviderSetModelInputPayload = {
  providerId: string;
  modelId: string;
  image: boolean;
};
export type PiProviderProbeProtocol = {
  api: string;
  /** true = 可用：真实验证通过，或服务端 supported_endpoint_types 声明支持（未验证时）。 */
  available: boolean;
  /** true = 经真实测试请求验证；false = 仅服务端声明或未验证。 */
  verified: boolean;
  cacheStats: boolean;
  modelIds?: string[];
  error?: string;
  /** Base URL that produced a successful request for this protocol. */
  resolvedBaseUrl?: string;
};
export type PiProviderProbeResult = {
  models: string[];
  modelDetails?: Array<{
    id: string;
    contextWindow?: number;
    maxTokens?: number;
    /** 目录上报的输入模态：含 image 表示支持图像输入（多模态）。 */
    input?: Array<'text' | 'image'>;
    thinkingLevelMap?: Record<string, string | null>;
  }>;
  protocols: PiProviderProbeProtocol[];
  recommendedApi?: string;
  /** Successful API base URL, including a discovered /v1 prefix when required. */
  recommendedBaseUrl?: string;
  /** 服务器类型（LM Studio native 端点 / vLLM /version 端点探测）。 */
  serverType?: PiProviderServerType;
  /** 模型目录请求失败原因（连接拒绝/超时/HTTP 错误等）；models 为空时用于界面提示。 */
  catalogError?: string;
};
export type PiCompactionSettings = {
  reserveTokens: number;
  keepRecentTokens: number;
  enabled: boolean;
  /** settings.json 中是否已显式写入 compaction（未写入时取 pi 默认值，UI 可按模型窗口套用推荐值）。 */
  configured?: boolean;
};
export type PiOAuthProgressEvent = {
  providerId: string;
  event: Record<string, unknown>;
};

/** 首选模型（pi settings.json 的 defaultProvider/defaultModel，新会话的初始模型）。 */
export type PiDefaultModel = { provider: string; id: string };
export type PiDefaultModelResult = { model: PiDefaultModel | null };

/** 自动重试设置（pi settings.retry）。 */
export type PiRetrySettingsResult = { enabled: boolean; maxRetries: number; baseDelayMs: number };
export type PiRetrySettingsPayload = Partial<PiRetrySettingsResult>;
/** 新会话默认思考深度（pi settings.defaultThinkingLevel；null = 未设置）。 */
export type PiDefaultThinkingResult = { level: string | null };

/** 新会话默认启用工具（pi settings.defaultTools；未配置时 pi 回退 read/bash/edit/write）。 */
export type PiDefaultToolsResult = { tools: string[] };

/** pi 内置工具全集（设置页工具开关枚举；顺序即展示顺序）。 */
export const PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;
/** 不可取消的核心工具（关闭后模型无法读写/执行，设置页开关锁定为开启）。 */
export const PI_CORE_TOOLS = ['read', 'bash', 'edit', 'write'] as const;
/** pi 未配置 defaultTools 时的默认工具列表（与 pi SDK 的 defaultActiveToolNames 一致）。 */
export const PI_DEFAULT_TOOLS = PI_CORE_TOOLS;

// —— piRuntime 命令补全 ——

export type PiCommandRow = { name: string; description?: string; source: string };
export type PiCommandListResult = { commands: PiCommandRow[] };

// —— piSessions：会话管理 ——

export type PiSessionRow = {
  path: string;
  id: string;
  /** 会话所属项目目录（分组用） */
  cwd: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  /** ISO 时间字符串（Date 不过 IPC） */
  created: string;
  modified: string;
  isCurrent: boolean;
  /** 该会话仍有保活的 pi runtime 正在执行。 */
  isRunning: boolean;
  archived: boolean;
  pinned: boolean;
};
export type PiSessionListResult = { sessions: PiSessionRow[] };
export type PiSessionSearchMatch = 'name' | 'firstMessage' | 'message';
export type PiSessionSearchRow = PiSessionRow & {
  match: PiSessionSearchMatch;
  snippet: string;
  /** 命中当前会话上下文中的消息下标；标题命中时没有目标消息。 */
  messageIndex?: number;
};
export type PiSessionSearchPayload = { query: string; limit?: number };
export type PiSessionSearchResult = { sessions: PiSessionSearchRow[] };
export type PiSessionPathPayload = { path: string; cwd?: string; title?: string; id?: string };
export type PiSessionPinPayload = PiSessionPathPayload & { pinned: boolean };
export type PiSessionArchivePayload = PiSessionPathPayload & { archived: boolean };

export type PiSessionProjectArchivePayload = { cwd: string; archived: boolean };
export type PiSessionRenamePayload = { path: string; name: string };
export type PiSessionForkResult = HostSuccess & { path?: string };
export type PiSessionExportRecord = {
  path: string;
  sessionPath: string;
  sessionId?: string;
  projectName: string;
  cwd: string;
  title: string;
  exportedAt: string;
};
export type PiSessionExportResult = HostSuccess & { path?: string; record?: PiSessionExportRecord };
export type PiSessionExportInfo = {
  directory: string;
  lastPath?: string;
  lastRecord?: PiSessionExportRecord;
  recentRecords?: PiSessionExportRecord[];
  records?: Record<string, PiSessionExportRecord>;
};

// —— piFiles：@ 文件引用（补全候选；展开在 piRuntime.prompt 前处理，格式照 pi file-processor）——

export type PiFileListPayload = { cwd: string };
export type PiFileListResult = { files: string[] };
/** 目录逐层浏览（手动文件面板）：列某目录的直接子项，目录/文件分开排序。 */
export type PiFileListDirPayload = { cwd: string; dir?: string };
export type PiFileListDirResult = { dir: string; dirs: string[]; files: string[] };

// —— piSkills：技能列表 ——

export type PiSkillSource = 'agentDir' | 'user' | 'project' | 'package';

export type PiSkillRow = {
  name: string;
  description: string;
  filePath: string;
  /** 来源分类（按路径推导；origin=package 时归 package） */
  source: PiSkillSource;
  /** pi 的 sourceInfo（source/scope/origin），UI 可直接展示 */
  sourceDetail?: string;
  disableModelInvocation: boolean;
  /** 是否只读（如 package 内部或无写权限文件，不可切换模式） */
  isReadOnly?: boolean;
};
export type PiSkillListResult = {
  skills: PiSkillRow[];
  /** runtime 未启动时 skills 恒为空（数据源是活动 runtime 的 resourceLoader） */
  runtimeActive: boolean;
};

/** 查看 skill 内容（SKILL.md 原文） */
export type PiSkillReadPayload = { filePath: string };
export type PiSkillReadResult = { content: string };

/** 外部 skills 目录（其他编程工具）扫描结果 */
export type PiExternalSkillStatus = 'new' | 'same' | 'conflict';
export type PiExternalSkill = {
  /** 目录名即 skill 名 */
  name: string;
  /** skill 目录绝对路径（含 SKILL.md） */
  dir: string;
  /** 与导入目标同名 skill 比较结果：无同名=new；SKILL.md 一致=same；不一致=conflict */
  status: PiExternalSkillStatus;
};
export type PiSkillExternalSource = {
  /** claude / codex / manual */
  id: string;
  dir: string;
  exists: boolean;
  skills: PiExternalSkill[];
};
export type PiSkillScanExternalPayload = { extraDirs?: string[] };
export type PiSkillScanExternalResult = {
  /** 导入目标目录（pi agentDir/skills） */
  targetDir: string;
  sources: PiSkillExternalSource[];
};

/** 冲突处理策略：skip=跳过；overwrite=覆盖目标；rename=以 name-2 等副本名导入 */
export type PiSkillImportStrategy = 'skip' | 'overwrite' | 'rename';
export type PiSkillImportItem = { name: string; dir: string; strategy: PiSkillImportStrategy };
export type PiSkillImportPayload = { skills: PiSkillImportItem[] };
export type PiSkillImportResult = {
  results: Array<{
    name: string;
    ok: boolean;
    /** imported / skipped / overwritten / renamed:<新名> */
    action: string;
    error?: string;
  }>;
};

/** 修改 skill 调用模式（写 SKILL.md 的 disable-model-invocation frontmatter） */
export type PiSkillSetModePayload = {
  filePath: string;
  disableModelInvocation: boolean;
};
export type PiSkillSetModeResult = {
  ok: boolean;
  error?: string;
};

// —— piPackages：扩展包管理（SDK PackageManager 的封装）——

export type PiPackageRow = {
  /** settings.json 里的原始 source（npm:<pkg> / git:<url> / 本地路径） */
  source: string;
  scope: 'user' | 'project';
  /** autoload=false 或带资源过滤（pi 的 PackageSource 对象形式） */
  filtered: boolean;
  installedPath?: string;
  /** 已安装包版本（读 installedPath/package.json，读不到则缺省） */
  version?: string;
  /** 显示名（npm 包名 / git 仓库名 / 目录名） */
  name: string;
};
export type PiPackageListResult = { packages: PiPackageRow[] };
export type PiPackageInstallPayload = { source: string };
export type PiPackageRemovePayload = { source: string; scope: 'user' | 'project' };
/** source 缺省 = 更新全部 */
export type PiPackageUpdatePayload = { source?: string };
export type PiPackageUpdateInfo = {
  source: string;
  displayName: string;
  type: 'npm' | 'git';
  scope: 'user' | 'project';
};
export type PiPackageCheckUpdatesResult = { updates: PiPackageUpdateInfo[] };
export type PiPackageCatalogType = 'extension' | 'skill' | 'theme' | 'prompt' | 'package';
export type PiPackageCatalogFilterType = Exclude<PiPackageCatalogType, 'package'> | '';
export type PiPackageCatalogSort = 'downloads' | 'recent' | 'name';
export type PiPackageCatalogQuery = {
  name?: string;
  type?: PiPackageCatalogFilterType;
  sort?: PiPackageCatalogSort;
  page?: number;
  /** 绕过 TTL 缓存，重新抓取 pi.dev。 */
  refresh?: boolean;
};
export type PiPackageCatalogRow = {
  name: string;
  description: string;
  author: string;
  downloads: number;
  publishedAt?: string;
  publishedLabel: string;
  types: PiPackageCatalogType[];
  detailsUrl: string;
  npmUrl?: string;
  repositoryUrl?: string;
};
export type PiPackageCatalogResult = {
  packages: PiPackageCatalogRow[];
  page: number;
  totalPages: number;
  totalCount: number;
  start: number;
  end: number;
  fetchedAt?: number;
  cacheState?: 'network' | 'fresh' | 'stale';
};
export type PiPackageDetailQuery = {
  name: string;
  /** 绕过 TTL 缓存，重新抓取详情页。 */
  refresh?: boolean;
};
export type PiPackageDetail = {
  name: string;
  description: string;
  version?: string;
  author?: string;
  license?: string;
  downloadsLabel?: string;
  publishedLabel?: string;
  publishedAt?: string;
  sizeLabel?: string;
  dependenciesLabel?: string;
  types: PiPackageCatalogType[];
  installCommand: string;
  npmUrl?: string;
  repositoryUrl?: string;
  homepageUrl?: string;
  reportUrl?: string;
  detailsUrl: string;
  manifestJson?: string;
  readmeHtml: string;
  securityNote?: string;
  fetchedAt: number;
  cacheState: 'network' | 'fresh' | 'stale';
};
export type PiPackageDetailResult = PiPackageDetail;
export type PiPackageProgressEvent = {
  type: 'start' | 'progress' | 'complete' | 'error';
  action: 'install' | 'remove' | 'update' | 'clone' | 'pull';
  source: string;
  message?: string;
};

// —— piMcp：MCP server 配置（pi-mcp-adapter 的标准 mcpServers 格式）——

export type PiMcpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  lifecycle?: string;
};

/** adapter 事件总线快照里的 per-server 状态（增强项，接不通则缺省） */
export type PiMcpServerStatus = {
  connected?: boolean;
  toolCount?: number;
  disabled?: boolean;
  error?: string;
  /** adapter 原始 status 文本 */
  raw?: string;
};

export type PiMcpScope = 'global' | 'project';

export type PiMcpServerRow = {
  name: string;
  scope: PiMcpScope;
  config: PiMcpServerConfig;
  status?: PiMcpServerStatus;
};

export type PiMcpListResult = {
  servers: PiMcpServerRow[];
  adapterInstalled: boolean;
  globalPath: string;
  projectPath?: string;
};

export type PiMcpUpsertPayload = {
  scope: PiMcpScope;
  name: string;
  /** 重命名时带原名 */
  originalName?: string;
  config: PiMcpServerConfig;
};
export type PiMcpServerRefPayload = { scope: PiMcpScope; name: string };
export type PiMcpSetDisabledPayload = PiMcpServerRefPayload & { disabled: boolean };

export type HostApiContract = {
  app: {
    version: () => string;
    name: () => string;
    platform: () => string;
    writeClipboard: (payload: AppClipboardWritePayload) => HostSuccess;
    writeClipboardImage: (payload: AppClipboardImagePayload) => HostSuccess;
    writeBinaryFile: (payload: AppWriteBinaryFilePayload) => HostSuccess;
    editCommand: (payload: AppEditCommandPayload) => HostSuccess;
  };
  shell: {
    openExternal: (payload: ShellOpenExternalPayload) => void;
    listApplications: () => ShellListApplicationsResult;
    openPath: (payload: ShellOpenPathPayload) => HostSuccess;
    openPathWith: (payload: ShellOpenPathWithPayload) => HostSuccess;
    showInFolder: (payload: { path: string }) => HostSuccess;
  };
  piSystem: {
    /** 完整环境检测（Node/npm/pi + SDK 能力兼容报告）。带短 TTL 缓存；force 绕过。 */
    detect: (payload?: { force?: boolean }) => PiEnvironment;
    /** 保留为底层无状态查询；版本检查调度由 versionCheck 负责。 */
    checkLatest: () => PiLatestVersionResult;
    /**
     * 安装/升级到 npm latest 版 pi。执行的命令有且仅有
     * `npm i -g @earendil-works/pi-coding-agent`。
     * 进度经 piSystem.installProgress 事件流式推送。
     */
    install: () => PiInstallResult;
  };
  versionCheck: {
    check: (payload?: { force?: boolean }) => VersionCheckSnapshot;
    getStatus: () => VersionCheckSnapshot;
    /** 渲染层挂载时拉取待展示通知：推送可能先于订阅丢失，拉取兜底并标记已读。 */
    getPendingNotice: () => VersionCheckPendingNotice | null;
    /** 用户关闭/点击通知后标记该版本已读，重启不再弹。 */
    dismissNotice: (payload: { kind: 'app' | 'pi'; latest: string }) => HostSuccess;
  };
  appUpdate: {
    download: () => AppUpdateDownloadResult;
    openDownloaded: () => HostSuccess;
    showDownloaded: () => HostSuccess;
    installDownloaded: (payload?: { force?: boolean }) => HostSuccess;
  };
  piRuntime: {
    /** 启动（或复用）指定 cwd 的会话运行时；更换 cwd 会重建。 */
    start: (payload: PiRuntimeStartPayload) => PiRuntimeStateResult;
    getState: () => PiRuntimeStateResult | null;
    getContextUsage: () => PiRuntimeContextUsage | null;
    getUsage: () => PiRuntimeUsageResult | null;
    /** 生成中调用按 payload.behavior 排队：默认 followUp（排队），'steer' = 当前轮插入。 */
    prompt: (payload: PiRuntimePromptPayload) => HostSuccess;
    abort: () => PiRuntimeAbortResult;
    /** 只停止正在运行的 bash 命令，不影响消息回合/压缩等（pi TUI Esc 的分支语义）。 */
    abortBash: () => HostSuccess;
    /** 移除一条排队消息（pi 仅 clearQueue 全清：main 侧快照→全清→按原顺序重排其余项）。 */
    queueRemove: (payload: PiRuntimeQueueItemPayload) => PiRuntimeQueueMutationResult;
    /** 在 pi 原生 steering/followUp 队列之间移动消息。 */
    queueMove: (payload: PiRuntimeQueueMovePayload) => PiRuntimeQueueMutationResult;
    newSession: (payload?: PiRuntimeNewSessionPayload) => HostSuccess;
    /** /compact [instructions]：手动压缩上下文，可带 pi 的自定义压缩指令。 */
    compact: (payload?: PiRuntimeCompactPayload) => HostSuccess;
    /** 消息级 fork：从某条历史 user 消息分叉出新会话并切过去（runtime.fork，TUI /fork 语义）。 */
    fork: (payload: PiRuntimeForkPayload) => PiRuntimeForkResult;
    /** 当前会话的分支树（SessionManager.getTree 拍平，供 /tree 面板展示）。 */
    getTree: () => PiRuntimeTreeResult;
    /** 同会话文件内跳分支（session.navigateTree，TUI /tree 语义）。 */
    navigateTree: (payload: PiRuntimeNavigatePayload) => PiRuntimeNavigateResult;
    setThinkingLevel: (payload: { level: string }) => PiRuntimeModelUpdateResult;
    setContextWindow: (payload: { contextWindow: number }) => PiRuntimeModelUpdateResult;
    setModel: (payload: { provider: string; id: string }) => PiRuntimeModelUpdateResult;
    /** /name <text>：重命名当前会话（session.setSessionName；返回 pi 规范化后的名字）。 */
    setSessionName: (payload: { name: string; notify?: boolean }) => HostSuccess & { name?: string };
    /** /session：当前会话信息（getSessionStats + 会话名）。 */
    getSessionInfo: () => PiRuntimeSessionInfo | null;
    /** /reload：重载扩展/skills/prompts/上下文文件（session.reload；streaming/compacting 中拒绝）。 */
    reload: () => HostSuccess;
    /** /export [path]：导出当前会话 HTML（缺省导到 Pi Desktop 的系统文档目录）。 */
    exportHtml: (payload?: PiRuntimeExportPayload) => PiSessionExportResult;
    /** / 补全：内置命令 + prompt 模板 + 扩展命令 + skills */
    getCommands: () => PiCommandListResult;
    /** `!cmd` bash 执行（session.executeBash；TUI `!`/`!!` 语义）。 */
    executeBash: (payload: PiRuntimeBashPayload) => HostSuccess;
    /** 扩展 UI 对话框的用户响应（按 requestId 配对挂起的 confirm/select/input）。 */
    uiResponse: (payload: PiUiResponsePayload) => HostSuccess;
  };
  providers: {
    list: () => PiProviderListResult;
    listModels: () => { models: PiModelRow[] };
    /** 经 pi ModelRuntime 刷新动态/远程 catalog；失败时保留 pi 的缓存模型。 */
    refresh: () => PiProviderRefreshResult;
    setApiKey: (payload: PiProviderSetKeyPayload) => PiProviderSetKeyResult;
    removeCredential: (payload: { providerId: string }) => HostSuccess;
    /** 删除 models.json 中的供应商定义；内置/扩展供应商不由此动作拥有。 */
    deleteCustom: (payload: { providerId: string }) => HostSuccess;
    startOAuth: (payload: { providerId: string }) => HostSuccess;
    addCustom: (payload: PiProviderAddCustomPayload) => HostSuccess;
    /** 编辑自定义供应商基本信息（名称/baseUrl/请求协议）；模型与凭证保持不变。 */
    updateCustom: (payload: PiProviderUpdateCustomPayload) => HostSuccess;
    /**
     * 切换 models.json 自定义模型的 reasoning 声明。目录探测不上报推理能力时，
     * 用户用此开关手动声明；活动会话正在使用该模型时同步重新应用模型定义。
     */
    setModelReasoning: (payload: PiProviderSetModelReasoningPayload) => HostSuccess;
    /**
     * 切换 models.json 自定义模型的图像输入声明（多模态）。规格表识别不到或
     * 网关剥离视觉时用户用此开关手动声明；活动会话正在使用该模型时同步重新应用。
     */
    setModelInput: (payload: PiProviderSetModelInputPayload) => HostSuccess;
    /**
     * 探测自定义供应商：默认只拉模型目录（GET /models，元数据，不发生成请求）；
     * verifyProtocols=true 时才对每个候选协议发送一次最小化测试请求（约 1 token）。
     */
    probe: (payload: PiProviderProbePayload) => PiProviderProbeResult;
    /** 首选模型（pi 原生 defaultProvider/defaultModel）；null = 未设置。 */
    getDefaultModel: () => PiDefaultModelResult;
    /**
     * 设为首选模型：有活动会话时走 session.setModel（切换 + pi 原生持久化）；
     * 无会话时经 pi SettingsManager 写 settings.json，新会话启动时应用。
     */
    setDefaultModel: (payload: PiDefaultModel) => HostSuccess;
    getCompaction: () => PiCompactionSettings;
    setCompaction: (payload: Partial<PiCompactionSettings>) => HostSuccess;
    /** 自动重试设置（pi settings.retry：开关/次数/基础退避）。 */
    getRetry: () => PiRetrySettingsResult;
    setRetry: (payload: PiRetrySettingsPayload) => HostSuccess;
    /** 新会话默认思考深度（pi settings.defaultThinkingLevel）。 */
    getDefaultThinking: () => PiDefaultThinkingResult;
    setDefaultThinking: (payload: { level: string }) => HostSuccess;
    /** 新会话默认启用工具（pi settings.defaultTools；未配置返回 pi 内置默认列表）。 */
    getDefaultTools: () => PiDefaultToolsResult;
    setDefaultTools: (payload: { tools: string[] }) => HostSuccess;
  };
  piSessions: {
    /** 当前 workspace cwd 的会话列表（modified 倒序）。runtime 未启动时回退 settings.workspaceCwd。 */
    list: (payload?: { scope?: 'cwd' }) => PiSessionListResult;
    /** 全部项目的会话（侧栏按 cwd 分组用）。 */
    listAll: () => PiSessionListResult;
    /** 搜索全部项目（含归档）的名称、首条消息和 pi SDK 提供的完整消息文本。 */
    search: (payload: PiSessionSearchPayload) => PiSessionSearchResult;
    /** 切换活动会话；成功后经 piRuntime.sessionReplaced 推全量状态。 */
    switch: (payload: PiSessionPathPayload) => HostSuccess;
    rename: (payload: PiSessionRenamePayload) => HostSuccess;
    /** 分叉到当前 cwd 并切过去；返回新会话文件路径。 */
    fork: (payload: PiSessionPathPayload) => PiSessionForkResult;
    archive: (payload: PiSessionArchivePayload) => HostSuccess;
    archiveProject: (payload: PiSessionProjectArchivePayload) => HostSuccess;
    pin: (payload: PiSessionPinPayload) => HostSuccess;
    /** pi 无删除 SDK API：删当前会话前先 newSession，随后移入系统废纸篓。 */
    remove: (payload: PiSessionPathPayload) => HostSuccess;
    /** 只导当前会话（exportToHtml 在 AgentSession 上），非当前先 switch。 */
    exportHtml: (payload: PiSessionPathPayload) => PiSessionExportResult;
    /** 系统统一导出目录 + 最近成功导出路径。 */
    getExportInfo: () => PiSessionExportInfo;
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => string | number | boolean | undefined;
    set: (payload: SettingsSetPayload) => HostSuccess;
  };
  proxy: {
    /** 当前代理模式与生效 URL（auto 模式会实时检测系统代理/常见端口）。 */
    detect: () => ProxyDetection;
    /** 按当前设置把代理应用到 pi 的全局网络栈（改设置后无需重启即生效）。 */
    apply: () => ProxyApplyResult;
  };
  piFiles: {
    /** @ 补全候选：cwd 下递归列文件（相对路径，排除 .git/node_modules，上限 200 条）。 */
    list: (payload: PiFileListPayload) => PiFileListResult;
    listDir: (payload: PiFileListDirPayload) => PiFileListDirResult;
  };
  workspace: {
    listChildren: (payload: WorkspaceListPayload) => WorkspaceListResult;
    readFile: (payload: WorkspaceReadPayload) => WorkspaceReadResult;
  };
  git: {
    /** 当前工作区的 git 分支（非仓库 / git 不可用返回 null；detached HEAD 返回 'detached'）。 */
    getBranch: (payload: { cwd: string }) => GitBranchResult;
    /** 列出当前仓库的本地分支及工作区是否干净。 */
    listBranches: (payload: { cwd: string }) => GitBranchListResult;
    /** 切换分支（带 dirty 预检与运行状态检查）。 */
    checkout: (payload: { cwd: string; branch: string }) => GitCheckoutResult;
  };
  piSkills: {
    /** 活动 runtime 的 skills（resourceLoader.getSkills()）；runtime 未启动返回空列表。 */
    list: () => PiSkillListResult;
    /** 读取 skill 的 SKILL.md 原文（查看用）。 */
    read: (payload: PiSkillReadPayload) => PiSkillReadResult;
    /** 扫描外部 skills 目录（Claude/Codex/extraDirs），并与导入目标比较同名状态。 */
    scanExternal: (payload?: PiSkillScanExternalPayload) => PiSkillScanExternalResult;
    /** 导入 = 复制目录到 agentDir/skills（不建软链）；同名按 strategy 处理。 */
    import: (payload: PiSkillImportPayload) => PiSkillImportResult;
    /** 设置 skill 调用模式（更新 SKILL.md frontmatter 并重载 runtime）。 */
    setInvocationMode: (payload: PiSkillSetModePayload) => PiSkillSetModeResult;
  };
  piPackages: {
    /** settings.json 里配置的扩展包（user + project scope 合并）。 */
    list: () => PiPackageListResult;
    /** 安装并持久化到 settings.json（installAndPersist）。 */
    install: (payload: PiPackageInstallPayload) => HostSuccess;
    /** 卸载并从 settings.json 移除（removeAndPersist）。 */
    remove: (payload: PiPackageRemovePayload) => HostSuccess;
    /** 更新单个（给 source）或全部（缺省）。 */
    update: (payload: PiPackageUpdatePayload) => HostSuccess;
    /** 检查可更新项（npm 查 registry / git 查 remote，可能较慢）。 */
    checkUpdates: () => PiPackageCheckUpdatesResult;
    /** 查询 pi.dev 官方 Package Catalog；Main 侧获取并解析，Renderer 不跨域抓网页。 */
    catalog: (payload: PiPackageCatalogQuery) => PiPackageCatalogResult;
    /** 查询单个 pi.dev Package 详情，包含 manifest 与经过清洗的 README HTML。 */
    detail: (payload: PiPackageDetailQuery) => PiPackageDetailResult;
  };
  piMcp: {
    /** 合并 <agentDir>/mcp.json（global）与 <cwd>/.mcp.json（project）的 server 列表。 */
    list: () => PiMcpListResult;
    /** 新增/编辑（originalName 用于重命名）；写回对应文件，保留文件里其他字段。 */
    upsert: (payload: PiMcpUpsertPayload) => HostSuccess;
    remove: (payload: PiMcpServerRefPayload) => HostSuccess;
    setDisabled: (payload: PiMcpSetDisabledPayload) => HostSuccess;
    /** 引导按钮：spawn 用户环境的 pi bin 执行 `pi install npm:pi-mcp-adapter`。 */
    installAdapter: () => HostSuccess;
  };
  piTrust: {
    /** 挂起中的项目信任确认（渲染层 mount 时拉取，防止事件早到丢失）。 */
    listPending: () => PiTrustRequestPayload[];
    /** 渲染层回传用户选择（label 缺省 = 取消，按不信任处理且不写记录）。 */
    respond: (payload: PiTrustRespondPayload) => HostSuccess;
    /** trust.json 全量记录（Settings 页展示/管理）。 */
    list: () => PiTrustListResult;
    /** 修改/撤销某条信任记录（写 ProjectTrustStore，下个会话生效）。 */
    set: (payload: PiTrustSetPayload) => HostSuccess;
  };
  dialog: {
    open: (payload: DialogOpenPayload) => DialogOpenResult;
    save: (payload: DialogSavePayload) => DialogSaveResult;
  };
  windows: {
    /** 在独立窗口打开指定会话；同会话已有窗口则聚焦复用。 */
    openDetached: (payload: WindowsOpenDetachedPayload) => void;
    /** 拖出开窗：落点在任一 app 窗口内则不动，否则以落点为中心创建。 */
    openDetachedAt: (payload: WindowsOpenDetachedAtPayload) => void;
    /** 聚焦绑定指定会话的窗口；没有对应窗口则新建独立窗口。 */
    focus: (payload: WindowsFocusPayload) => void;
    /** 只聚焦已有会话窗口；返回 false 表示会话尚未被其他窗口占用。 */
    focusIfOpen: (payload: WindowsFocusPayload) => boolean;
    /** 同步当前窗口的全部面板会话，避免同一会话从其他入口重复开窗。 */
    setSessions: (payload: WindowsSetSessionsPayload) => void;
    /** 窗口↔会话绑定清单（调试/测试用）。 */
    list: () => WindowListEntry[];
    /** 工作台 docked 展开：窗口向右加宽，让面板占新增宽度而不是挤压聊天列。 */
    expandRight: (payload: WindowsExpandRightPayload) => WindowsExpandRightResult;
    /** 收回 expandRight 的加宽；展开期间用户手动改过窗口宽度则不动作。 */
    restoreExpandRight: () => void;
    /** frameless 自绘标题栏：最小化当前窗口。 */
    minimize: () => void;
    /** frameless 自绘标题栏：最大化/还原当前窗口。 */
    maximizeToggle: () => void;
    /** frameless 自绘标题栏：查询当前窗口是否最大化（图标切换用）。 */
    isMaximized: () => boolean;
    /** frameless 自绘标题栏：关闭当前窗口。必须走 win.close() 复用
     * 「close→hide 到托盘」语义，绝不 app.quit()（那是托盘「退出」的职责）。 */
    close: () => void;
  };
  review: {
    /** Git HEAD 或非 Git 会话 baseline ↔ 当前磁盘快照的改动汇总。 */
    getSummary: () => ReviewSummaryResult;
    /** 单文件 unified diff（活视图，每次调用重新对比当前磁盘）。 */
    getFileDiff: (payload: ReviewFileDiffPayload) => ReviewFileDiffResult;
    /** 文件级回滚：对该文件的 baseline→当前 diff 执行 git apply -R；冲突文件拒绝。 */
    revertFile: (payload: ReviewRevertFilePayload) => HostSuccess;
    /** hunk 级回滚：git apply -R 渲染层重建的单 hunk patch；apply 失败返回错误。 */
    revertHunk: (payload: ReviewRevertHunkPayload) => HostSuccess;
  };
  notify: {
    /** 渲染层上报可通知事件；main 按 settings.notifyMode + 窗口焦点决定是否弹系统通知。 */
    dispatch: (payload: NotifyDispatchPayload) => HostSuccess;
  };
};

export type HostApiModule = keyof HostApiContract & string;
export type HostApiAction<M extends HostApiModule> = keyof HostApiContract[M] & string;
export type HostApiFunction<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = HostApiContract[M][A] extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : never;
export type HostApiPayload<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? undefined
  : Parameters<HostApiFunction<M, A>>[0];
export type HostApiResult<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Awaited<ReturnType<HostApiFunction<M, A>>>;
export type HostApiPayloadArgs<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? []
  : undefined extends HostApiPayload<M, A>
    ? [payload?: HostApiPayload<M, A>]
    : [payload: HostApiPayload<M, A>];
