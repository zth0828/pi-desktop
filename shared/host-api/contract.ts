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
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => string | undefined;
    set: (payload: SettingsSetPayload) => HostSuccess;
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
