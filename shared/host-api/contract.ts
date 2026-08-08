/**
 * Host API contract — the single source of truth for Renderer↔Main calls.
 * Renderer 只允许通过这里声明的 module.action 调后端（见 AGENTS.md）。
 * 机制移植自 ClawX，module 清单按 Pi Desktop 收敛（M1 起步，按里程碑扩展）。
 */
export type JsonRecord = Record<string, unknown>;
export type HostSuccess = { success: boolean; error?: string };

export type ShellOpenExternalPayload = { url: string };
export type AppClipboardWritePayload = { text: string };

// —— piSystem：pi/Node/npm 环境检测与安装引导（M1）——

export type PiInstallKind = 'npm' | 'non-npm';

export type NodeDetectResult = {
  found: boolean;
  path?: string;
  version?: string;
  meetsMin: boolean;
};

export type NpmDetectResult = {
  found: boolean;
  version?: string;
  /** realpath 后的 npm 全局 root（…/lib/node_modules） */
  globalRoot?: string;
};

export type PiDetectResult = {
  found: boolean;
  binPath?: string;
  realBinPath?: string;
  packageRoot?: string;
  version?: string;
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
};

export type PiLatestVersionResult = {
  latest?: string;
  checkedAt: number;
};

export type PiInstallResult = HostSuccess & {
  version?: string;
};

// —— piRuntime：SDK 会话运行时（M2）——

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

// —— piRuntime 排队消息操作（steer/followUp 队列；pi 只有 clearQueue 全清，单条移除=快照后重排）——

export type PiRuntimeQueueKind = 'steering' | 'followUp';
export type PiRuntimeQueueItemPayload = { kind: PiRuntimeQueueKind; index: number };

export type PiRuntimeModelInfo = { provider: string; id: string; name?: string };

export type PiRuntimeContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

export type PiRuntimeStateResult = {
  sessionId: string;
  cwd: string;
  generation: number;
  model?: PiRuntimeModelInfo;
  thinkingLevel: string;
  isStreaming: boolean;
  /** pi AgentMessage[]，渲染层按结构渲染（user/assistant/toolResult） */
  messages: unknown[];
  /**
   * 与 messages 平行的会话 entry id（仅 user 消息 entry 有值，其余为 null）。
   * pi 的 AgentMessage 本身不带 entryId；这里按 buildSessionContext 的
   * flatMap(sessionEntryToContextMessages) 对齐重建，供消息级 fork 使用。
   */
  messageEntryIds: (string | null)[];
  sessionFile?: string;
  contextUsage?: PiRuntimeContextUsage;
};

// —— piRuntime 消息级 fork / 分支导航（/tree）——

export type PiRuntimeForkPayload = { entryId: string };
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
export type PiRuntimeNavigatePayload = { targetId: string };
export type PiRuntimeNavigateResult = HostSuccess & {
  /** 目标是 user 消息时 pi 把文本退回编辑器（TUI /tree 语义） */
  editorText?: string;
};

// —— piRuntime 斜杠命令配套（TUI onSubmit 内建命令的壳映射）——

/** /compact <instructions>：pi handleCompactCommand 的自定义压缩指令 */
export type PiRuntimeCompactPayload = { customInstructions?: string };
/** /export [path]：pi handleExportCommand（缺省导到会话同目录 HTML） */
export type PiRuntimeExportPayload = { outputPath?: string };

/** /session 展示的会话信息（pi getSessionStats + sessionName 的子集） */
export type PiRuntimeSessionInfo = {
  name?: string;
  sessionId: string;
  sessionFile?: string;
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

export type PiUiRequestKind = 'confirm' | 'select' | 'input';

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
  /** 扩展传入的超时（ExtensionUIDialogOptions.timeout），到期 main 侧按取消兜底 */
  timeoutMs?: number;
};

export type PiUiResponsePayload = {
  requestId: string;
  /** confirm=boolean；select/input=用户文本；取消/超时/会话替换时缺省 */
  value?: string | boolean;
  cancelled?: boolean;
};

// —— settings：壳自身设置（electron-store 持久化）——

export type SettingsSnapshot = {
  language?: 'zh' | 'en';
  workspaceCwd?: string;
  theme?: 'light' | 'dark' | 'system';
  /** 系统通知档位：always=总是，unfocused=仅窗口失焦（默认），off=关闭 */
  notifyMode?: 'always' | 'unfocused' | 'off';
};

export type SettingsGetPayload = { key: keyof SettingsSnapshot };
export type SettingsSetPayload = { key: keyof SettingsSnapshot; value: string | undefined };

// —— dialog：系统对话框 ——

export type DialogOpenPayload = {
  title?: string;
  defaultPath?: string;
  properties?: Array<'openFile' | 'openDirectory' | 'createDirectory'>;
};
export type DialogOpenResult = { canceled: boolean; filePaths: string[] };

// —— notify：macOS 系统通知（渲染层只上报事件，焦点判定与弹通知都在 main）——

export type NotifyKind = 'runCompleted' | 'uiRequest';
export type NotifyDispatchPayload = {
  kind: NotifyKind;
  /** 已在渲染层本地化的标题/正文 */
  title: string;
  body?: string;
};

// —— providers：模型/供应商管理（M3）——

export type PiProviderRow = {
  id: string;
  name: string;
  authMethods: string[];
  configured: boolean;
  modelCount: number;
};
export type PiProviderListResult = { providers: PiProviderRow[] };
export type PiProviderSetKeyPayload = { providerId: string; apiKey: string };
export type PiModelRow = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
};
export type PiProviderAddCustomPayload = {
  id: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
  models: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    contextWindow?: number;
    maxTokens?: number;
  }>;
};
export type PiOAuthProgressEvent = {
  providerId: string;
  event: Record<string, unknown>;
};

/** 首选模型（pi settings.json 的 defaultProvider/defaultModel，新会话的初始模型）。 */
export type PiDefaultModel = { provider: string; id: string };
export type PiDefaultModelResult = { model: PiDefaultModel | null };

// —— piRuntime 命令补全（M3，docs §4.3）——

export type PiCommandRow = { name: string; description?: string; source: string };
export type PiCommandListResult = { commands: PiCommandRow[] };

// —— piSessions：会话管理（M4，docs §4.4）——

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
  archived: boolean;
};
export type PiSessionListResult = { sessions: PiSessionRow[] };
export type PiSessionPathPayload = { path: string; cwd?: string };
export type PiSessionArchivePayload = PiSessionPathPayload & { archived: boolean };
export type PiSessionProjectArchivePayload = { cwd: string; archived: boolean };
export type PiSessionRenamePayload = { path: string; name: string };
export type PiSessionForkResult = HostSuccess & { path?: string };
export type PiSessionExportResult = HostSuccess & { path?: string };

// —— piFiles：@ 文件引用（补全候选；展开在 piRuntime.prompt 前处理，格式照 pi file-processor）——

export type PiFileListPayload = { cwd: string };
export type PiFileListResult = { files: string[] };

// —— piSkills：技能列表（M5）——

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
};
export type PiSkillListResult = {
  skills: PiSkillRow[];
  /** runtime 未启动时 skills 恒为空（数据源是活动 runtime 的 resourceLoader） */
  runtimeActive: boolean;
};

// —— piPackages：扩展包管理（M5，SDK PackageManager 的封装）——

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

// —— piMcp：MCP server 配置（M5，pi-mcp-adapter 的标准 mcpServers 格式，docs §4.7）——

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
  };
  shell: {
    openExternal: (payload: ShellOpenExternalPayload) => void;
  };
  piSystem: {
    /** 完整环境检测（Node/npm/pi + 版本判定）。带短 TTL 缓存；force 绕过。 */
    detect: (payload?: { force?: boolean }) => PiEnvironment;
    /** 查询 npm registry 上 pi 最新版本；失败静默（latest 缺省）。 */
    checkLatest: () => PiLatestVersionResult;
    /**
     * 安装/升级到 npm 版 pi。执行的命令有且仅有
     * `npm i -g @earendil-works/pi-coding-agent`（方案 B，见 docs §3）。
     * 进度经 piSystem.installProgress 事件流式推送。
     */
    install: () => PiInstallResult;
  };
  piRuntime: {
    /** 启动（或复用）指定 cwd 的会话运行时；更换 cwd 会重建。 */
    start: (payload: PiRuntimeStartPayload) => PiRuntimeStateResult;
    getState: () => PiRuntimeStateResult | null;
    getContextUsage: () => PiRuntimeContextUsage | null;
    /** 生成中调用按 payload.behavior 排队：默认 followUp（排队），'steer' = 当前轮插入（§4.1）。 */
    prompt: (payload: PiRuntimePromptPayload) => HostSuccess;
    abort: () => HostSuccess;
    /** 移除一条排队消息（pi 仅 clearQueue 全清：main 侧快照→全清→按原顺序重排其余项）。 */
    queueRemove: (payload: PiRuntimeQueueItemPayload) => HostSuccess;
    /** 排队消息「立即发送」：移出队列后 steer（流式中）或直接 prompt（空闲时）。 */
    queueSteerNow: (payload: PiRuntimeQueueItemPayload) => HostSuccess;
    newSession: () => HostSuccess;
    /** /compact [instructions]：手动压缩上下文，可带 pi 的自定义压缩指令。 */
    compact: (payload?: PiRuntimeCompactPayload) => HostSuccess;
    /** 消息级 fork：从某条历史 user 消息分叉出新会话并切过去（runtime.fork，TUI /fork 语义）。 */
    fork: (payload: PiRuntimeForkPayload) => PiRuntimeForkResult;
    /** 当前会话的分支树（SessionManager.getTree 拍平，供 /tree 面板展示）。 */
    getTree: () => PiRuntimeTreeResult;
    /** 同会话文件内跳分支（session.navigateTree，TUI /tree 语义）。 */
    navigateTree: (payload: PiRuntimeNavigatePayload) => PiRuntimeNavigateResult;
    setThinkingLevel: (payload: { level: string }) => HostSuccess;
    setModel: (payload: { provider: string; id: string }) => HostSuccess;
    /** /name <text>：重命名当前会话（session.setSessionName；返回 pi 规范化后的名字）。 */
    setSessionName: (payload: { name: string }) => HostSuccess & { name?: string };
    /** /session：当前会话信息（getSessionStats + 会话名）。 */
    getSessionInfo: () => PiRuntimeSessionInfo | null;
    /** /reload：重载扩展/skills/prompts/上下文文件（session.reload；streaming/compacting 中拒绝）。 */
    reload: () => HostSuccess;
    /** /export [path]：导出当前会话 HTML（缺省导到会话同目录）。 */
    exportHtml: (payload?: PiRuntimeExportPayload) => PiSessionExportResult;
    /** / 补全：内置命令 + prompt 模板 + 扩展命令 + skills */
    getCommands: () => PiCommandListResult;
    /** 扩展 UI 对话框的用户响应（按 requestId 配对挂起的 confirm/select/input）。 */
    uiResponse: (payload: PiUiResponsePayload) => HostSuccess;
  };
  providers: {
    list: () => PiProviderListResult;
    listModels: () => { models: PiModelRow[] };
    setApiKey: (payload: PiProviderSetKeyPayload) => HostSuccess;
    removeCredential: (payload: { providerId: string }) => HostSuccess;
    startOAuth: (payload: { providerId: string }) => HostSuccess;
    addCustom: (payload: PiProviderAddCustomPayload) => HostSuccess;
    /** 首选模型（pi 原生 defaultProvider/defaultModel）；null = 未设置。 */
    getDefaultModel: () => PiDefaultModelResult;
    /**
     * 设为首选模型：有活动会话时走 session.setModel（切换 + pi 原生持久化）；
     * 无会话时经 pi SettingsManager 写 settings.json，新会话启动时应用。
     */
    setDefaultModel: (payload: PiDefaultModel) => HostSuccess;
  };
  piSessions: {
    /** 当前 workspace cwd 的会话列表（modified 倒序）。runtime 未启动时回退 settings.workspaceCwd。 */
    list: (payload?: { scope?: 'cwd' }) => PiSessionListResult;
    /** 全部项目的会话（侧栏按 cwd 分组用）。 */
    listAll: () => PiSessionListResult;
    /** 切换活动会话；成功后经 piRuntime.sessionReplaced 推全量状态。 */
    switch: (payload: PiSessionPathPayload) => HostSuccess;
    rename: (payload: PiSessionRenamePayload) => HostSuccess;
    /** 分叉到当前 cwd 并切过去；返回新会话文件路径。 */
    fork: (payload: PiSessionPathPayload) => PiSessionForkResult;
    archive: (payload: PiSessionArchivePayload) => HostSuccess;
    archiveProject: (payload: PiSessionProjectArchivePayload) => HostSuccess;
    /** pi 无删除 SDK API：删当前会话前先 newSession，随后移入系统废纸篓。 */
    remove: (payload: PiSessionPathPayload) => HostSuccess;
    /** v1 简化：只导当前会话（exportToHtml 在 AgentSession 上），非当前先 switch。导出到会话同目录。 */
    exportHtml: (payload: PiSessionPathPayload) => PiSessionExportResult;
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => string | undefined;
    set: (payload: SettingsSetPayload) => HostSuccess;
  };
  piFiles: {
    /** @ 补全候选：cwd 下递归列文件（相对路径，排除 .git/node_modules，上限 200 条）。 */
    list: (payload: PiFileListPayload) => PiFileListResult;
  };
  piSkills: {
    /** 活动 runtime 的 skills（resourceLoader.getSkills()）；runtime 未启动返回空列表。 */
    list: () => PiSkillListResult;
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
  dialog: {
    open: (payload: DialogOpenPayload) => DialogOpenResult;
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
