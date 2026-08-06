/**
 * Host API contract — the single source of truth for Renderer↔Main calls.
 * Renderer 只允许通过这里声明的 module.action 调后端（见 AGENTS.md）。
 * 机制移植自 ClawX，module 清单按 Pi Desktop 收敛（M1 起步，按里程碑扩展）。
 */
export type JsonRecord = Record<string, unknown>;
export type HostSuccess = { success: boolean; error?: string };

export type ShellOpenExternalPayload = { url: string };

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
export type PiRuntimePromptPayload = { text: string; images?: unknown[] };

export type PiRuntimeModelInfo = { provider: string; id: string; name?: string };

export type PiRuntimeStateResult = {
  sessionId: string;
  cwd: string;
  generation: number;
  model?: PiRuntimeModelInfo;
  thinkingLevel: string;
  isStreaming: boolean;
  /** pi AgentMessage[]，渲染层按结构渲染（user/assistant/toolResult） */
  messages: unknown[];
  sessionFile?: string;
};

// —— settings：壳自身设置（electron-store 持久化）——

export type SettingsSnapshot = {
  language?: 'zh' | 'en';
  workspaceCwd?: string;
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
export type PiModelRow = { provider: string; id: string; name?: string; reasoning?: boolean };
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

// —— piRuntime 命令补全（M3，docs §4.3）——

export type PiCommandRow = { name: string; description?: string; source: string };
export type PiCommandListResult = { commands: PiCommandRow[] };

// —— piSessions：会话管理（M4，docs §4.4）——

export type PiSessionRow = {
  path: string;
  id: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  /** ISO 时间字符串（Date 不过 IPC） */
  created: string;
  modified: string;
  isCurrent: boolean;
};
export type PiSessionListResult = { sessions: PiSessionRow[] };
export type PiSessionPathPayload = { path: string };
export type PiSessionRenamePayload = { path: string; name: string };
export type PiSessionForkResult = HostSuccess & { path?: string };
export type PiSessionExportResult = HostSuccess & { path?: string };

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
export type PiPackageProgressEvent = {
  type: 'start' | 'progress' | 'complete' | 'error';
  action: 'install' | 'remove' | 'update' | 'clone' | 'pull';
  source: string;
  message?: string;
};

export type HostApiContract = {
  app: {
    version: () => string;
    name: () => string;
    platform: () => string;
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
    /** 生成中调用自动走 steer（§4.1）。 */
    prompt: (payload: PiRuntimePromptPayload) => HostSuccess;
    abort: () => HostSuccess;
    newSession: () => HostSuccess;
    compact: () => HostSuccess;
    setThinkingLevel: (payload: { level: string }) => HostSuccess;
    setModel: (payload: { provider: string; id: string }) => HostSuccess;
    /** / 补全：内置命令 + prompt 模板 + skills */
    getCommands: () => PiCommandListResult;
  };
  providers: {
    list: () => PiProviderListResult;
    listModels: () => { models: PiModelRow[] };
    setApiKey: (payload: PiProviderSetKeyPayload) => HostSuccess;
    removeCredential: (payload: { providerId: string }) => HostSuccess;
    startOAuth: (payload: { providerId: string }) => HostSuccess;
    addCustom: (payload: PiProviderAddCustomPayload) => HostSuccess;
  };
  piSessions: {
    /** 当前 workspace cwd 的会话列表（modified 倒序）。runtime 未启动时回退 settings.workspaceCwd。 */
    list: (payload?: { scope?: 'cwd' }) => PiSessionListResult;
    /** 切换活动会话；成功后经 piRuntime.sessionReplaced 推全量状态。 */
    switch: (payload: PiSessionPathPayload) => HostSuccess;
    rename: (payload: PiSessionRenamePayload) => HostSuccess;
    /** 分叉到当前 cwd 并切过去；返回新会话文件路径。 */
    fork: (payload: PiSessionPathPayload) => PiSessionForkResult;
    /** pi 无删除 API：壳直接删 JSONL 文件；删当前会话前先 newSession。 */
    remove: (payload: PiSessionPathPayload) => HostSuccess;
    /** v1 简化：只导当前会话（exportToHtml 在 AgentSession 上），非当前先 switch。导出到会话同目录。 */
    exportHtml: (payload: PiSessionPathPayload) => PiSessionExportResult;
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => string | undefined;
    set: (payload: SettingsSetPayload) => HostSuccess;
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
  };
  dialog: {
    open: (payload: DialogOpenPayload) => DialogOpenResult;
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
