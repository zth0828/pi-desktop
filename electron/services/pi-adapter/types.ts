import type {
  PiCapabilities,
  PiCompatibilityReport,
  PiCompactionSettings,
  PiDefaultModel,
  PiRetrySettingsResult,
  PiPackageProgressEvent,
} from '@shared/host-api/contract';

/** Raw pi types are intentionally not exported. Adapter implementations may import the
 * upstream package, but domain services only receive these Pi Desktop ports. */
export type PiPromptInput = {
  text: string;
  images?: unknown[];
  streamingBehavior?: 'steer' | 'followUp';
  preflightResult?: (accepted: boolean) => void;
};

export type PiSessionDescriptor = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  allMessagesText?: string;
  messageCount: number;
  created: Date;
  modified: Date;
};

export type PiSessionDocumentHandle = {
  readonly path?: string;
  readonly identity: string;
  getSessionName(): string | undefined;
  getCwd(): string;
  getLeafId(): string | null;
  getEntry(id: string): PiSessionEntry | undefined;
};

export type PiSessionEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string | number;
  [key: string]: unknown;
};

export type PiModelDescriptor = {
  provider: string;
  id: string;
  name?: string;
  api: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type PiProviderDescriptor = {
  id: string;
  name: string;
  baseUrl?: string;
  auth?: { apiKey?: unknown; oauth?: unknown };
};

export type PiAuthResolution = {
  auth: { apiKey?: string; baseUrl?: string; headers?: Record<string, unknown> };
  source?: string;
};

export type PiModelRuntimeHandle = { readonly identity: string };
export type PiModelHandle = { readonly identity: string; readonly provider: string; readonly id: string };
export type PiSettingsHandle = { readonly identity: string };
export type PiPackageManagerHandle = { readonly identity: string };
export type PiEventBusHandle = { readonly identity: string };

export type PiSessionView = {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly isStreaming: boolean;
  readonly isBashRunning: boolean;
  readonly isCompacting: boolean;
  readonly isRetrying: boolean;
  readonly model?: PiModelDescriptor;
  readonly thinkingLevel: string;
  readonly messages: readonly unknown[];
  readonly sessionManager: PiSessionDocumentHandle;
  readonly extensionRunner: PiExtensionRunnerPort;
};

export type PiExtensionRunnerPort = {
  getRegisteredCommands(): Array<{ name: string; invocationName: string; description?: string; sourceInfo?: unknown }>;
  emitUserBash(input: { type: 'user_bash'; command: string; excludeFromContext: boolean; cwd: string }): Promise<{
    result?: unknown;
    operations?: unknown;
  } | undefined>;
};

export type PiRuntimeHandle = {
  readonly identity: string;
  readonly session: PiSessionPort;
  readonly eventBus: PiEventBusPort;
  readonly settings: PiSettingsHandle;
  readonly modelRuntime: PiModelRuntimeHandle;
  newSession(options?: unknown): Promise<{ cancelled: boolean }>;
  switchSession(path: string, options?: unknown): Promise<{ cancelled: boolean }>;
  fork(entryId: string, options?: unknown): Promise<{ cancelled: boolean; selectedText?: string }>;
};

export type PiSessionPort = {
  readonly view: PiSessionView;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly isStreaming: boolean;
  readonly isBashRunning: boolean;
  readonly isCompacting: boolean;
  readonly isRetrying: boolean;
  readonly model?: PiModelDescriptor;
  readonly thinkingLevel: string;
  readonly messages: readonly unknown[];
  readonly sessionManager: PiSessionDocumentHandle;
  readonly extensionRunner: PiExtensionRunnerPort;
  prompt(input: PiPromptInput): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  abortBash(): void;
  abortCompaction(): void;
  abortBranchSummary(): void;
  abortRetry(): void;
  compact(customInstructions?: string): Promise<unknown>;
  navigateTree(targetId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean }>;
  newSession(options?: unknown): Promise<{ cancelled: boolean }>;
  switchSession(path: string, options?: unknown): Promise<{ cancelled: boolean }>;
  fork(entryId: string, options?: unknown): Promise<{ cancelled: boolean; selectedText?: string }>;
  reload(): Promise<void>;
  bindExtensions(options: PiBindExtensionsOptions): Promise<void>;
  waitForIdle(): Promise<void>;
  setSessionName(name: string): void;
  setThinkingLevel(level: string): void;
  setModel(model: PiModelHandle): Promise<void>;
  exportToHtml(outputPath?: string): Promise<string>;
  getAvailableThinkingLevels(): string[];
  getSessionStats(): PiSessionStats;
  getContextUsage(): { tokens?: number; contextWindow?: number; percent?: number } | undefined;
  getEntries(): PiSessionEntry[];
  getBranch(): PiSessionEntry[];
  getTree(): PiSessionTreeNode[];
  buildContextEntries(): PiSessionEntry[];
  getModelContextMessages(entry: PiSessionEntry): unknown[];
  getSteeringMessages(): string[];
  getFollowUpMessages(): string[];
  clearQueue(): void;
  clearAgentQueues(): void;
  executeBash(command: string, options?: { excludeFromContext?: boolean; operations?: unknown }): Promise<void>;
  recordBashResult(command: string, result: unknown, options?: { excludeFromContext?: boolean }): void;
};

export type PiSessionStats = {
  sessionId: string;
  sessionFile?: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
};

export type PiSessionTreeNode = {
  entry: PiSessionEntry;
  label?: string;
  children: PiSessionTreeNode[];
};

export type PiBindExtensionsOptions = {
  mode: 'print';
  uiContext: unknown;
  commandContextActions: {
    waitForIdle: () => Promise<void>;
    newSession: (options?: unknown) => Promise<{ cancelled: boolean }>;
    fork: (entryId: string, options?: unknown) => Promise<{ cancelled: boolean }>;
    navigateTree: (targetId: string, options?: unknown) => Promise<{ cancelled: boolean; editorText?: string }>;
    switchSession: (path: string, options?: unknown) => Promise<{ cancelled: boolean }>;
    reload: () => Promise<void>;
  };
  onError: (error: unknown) => void;
};

export type PiRuntimePort = {
  create(input: PiCreateRuntimeInput): Promise<PiRuntimeHandle>;
  dispose(runtime: PiRuntimeHandle): void;
  calculateContextTokens(usage: unknown): number;
  estimateTokens(message: unknown): number;
};

export type PiCreateRuntimeInput = {
  cwd: string;
  sessionPath?: string;
  eventBus?: PiEventBusHandle;
  resolveTrust?: (input: { cwd: string; trustStore: unknown; defaultProjectTrust: unknown; extensionsResult: unknown; onExtensionError: (message: string) => void }) => Promise<boolean>;
  trustSelection?: (cwd: string, title: string, options: string[]) => Promise<string | undefined>;
  workspaceBoundary?: boolean;
  appendSystemPrompt?: (base: string[]) => string[];
  uiContext?: unknown;
  getProjectTrust?: (cwd: string) => boolean | undefined;
  setProjectTrust?: (cwd: string, trusted: boolean) => void;
};

export type PiEventBusPort = {
  on(channel: string, listener: (data: unknown) => void): () => void;
};

export type PiPathPort = {
  getAgentDir(): string;
  getCliPath(): string | undefined;
  ensureTool(tool: 'fd' | 'rg', silent?: boolean): Promise<string>;
};

export type PiSessionCatalogPort = {
  list(cwd: string): Promise<PiSessionDescriptor[]>;
  listAll(): Promise<PiSessionDescriptor[]>;
  open(path: string): PiSessionDocumentHandle;
  create(cwd: string): PiSessionDocumentHandle;
  forkFrom(path: string, cwd: string): PiSessionDocumentHandle;
  getEntries(document: PiSessionDocumentHandle): PiSessionEntry[];
  getBranch(document: PiSessionDocumentHandle): PiSessionEntry[];
  appendCustomEntry(document: PiSessionDocumentHandle, type: string, data: unknown): string;
  appendSessionInfo(document: PiSessionDocumentHandle, name: string): string;
  toContextMessages(entry: PiSessionEntry): unknown[];
};

export type PiProviderPort = {
  createRuntime(input?: { cwd?: string; agentDir?: string }): Promise<PiModelRuntimeHandle>;
  listProviders(runtime: PiModelRuntimeHandle): PiProviderDescriptor[];
  getRegisteredProviderIds(runtime: PiModelRuntimeHandle): string[];
  hasConfiguredAuth(runtime: PiModelRuntimeHandle, providerId: string): boolean;
  getModels(runtime: PiModelRuntimeHandle, providerId: string): PiModelDescriptor[];
  getAvailable(runtime: PiModelRuntimeHandle): Promise<PiModelDescriptor[]>;
  getModel(runtime: PiModelRuntimeHandle, provider: string, id: string): PiModelHandle | null;
  getAuth(runtime: PiModelRuntimeHandle, providerOrModel: string | PiModelHandle): Promise<PiAuthResolution | null>;
  login(runtime: PiModelRuntimeHandle, provider: string, method: 'api_key' | 'oauth', callbacks: { prompt: (request: unknown) => Promise<string>; notify: (event: unknown) => void }): Promise<void>;
  logout(runtime: PiModelRuntimeHandle, provider: string): Promise<void>;
  refresh(runtime: PiModelRuntimeHandle, input: { allowNetwork: boolean; force?: boolean; signal?: AbortSignal }): Promise<{ aborted?: boolean; errors: Map<string, Error> }>;
};

export type PiSettingsPort = {
  open(input?: { cwd?: string; agentDir?: string; projectTrusted?: boolean }): PiSettingsHandle;
  getCompaction(handle: PiSettingsHandle): PiCompactionSettings;
  getRetry(handle: PiSettingsHandle): PiRetrySettingsResult;
  getDefaultModel(handle: PiSettingsHandle): PiDefaultModel | null;
  getDefaultThinking(handle: PiSettingsHandle): string | null;
  getDefaultTools(handle: PiSettingsHandle): string[] | null;
  getBranchSummarySkipPrompt(handle: PiSettingsHandle): boolean;
  isProjectTrusted(handle: PiSettingsHandle): boolean;
  setDefaultModel(handle: PiSettingsHandle, model: PiDefaultModel): void;
  setDefaultThinking(handle: PiSettingsHandle, level: string): void;
  flush(handle: PiSettingsHandle): Promise<void>;
  reload(handle: PiSettingsHandle): Promise<void>;
  updateJson(agentDir: string, fileName: 'settings.json' | 'models.json', patch: (doc: Record<string, unknown>) => void): Promise<void>;
};

export type PiPackagePort = {
  create(input: { cwd: string; agentDir: string; scope: 'user' | 'project' }): Promise<PiPackageManagerHandle>;
  list(handle: PiPackageManagerHandle): PiPackageRow[];
  install(handle: PiPackageManagerHandle, source: string): Promise<void>;
  remove(handle: PiPackageManagerHandle, source: string, local: boolean): Promise<boolean>;
  update(handle: PiPackageManagerHandle, source?: string): Promise<void>;
  checkUpdates(handle: PiPackageManagerHandle): Promise<PiPackageUpdate[]>;
  onProgress(handle: PiPackageManagerHandle, listener: (event: PiPackageProgressEvent) => void): () => void;
  invalidate(): void;
};

export type PiPackageRow = { source: string; scope: 'user' | 'project'; filtered: boolean; installedPath?: string };
export type PiPackageUpdate = { source: string; displayName: string; type: 'npm' | 'git'; scope: 'user' | 'project' };

export type PiResourcePort = {
  getSkills(runtime: PiRuntimeHandle): Array<Record<string, unknown>>;
  getPrompts(runtime: PiRuntimeHandle): Array<Record<string, unknown>>;
  getExtensions(runtime: PiRuntimeHandle): Array<Record<string, unknown>>;
  getThemes(runtime: PiRuntimeHandle): Array<Record<string, unknown>>;
  reload(runtime: PiRuntimeHandle): Promise<void>;
};

export type PiTrustPort = {
  getProjectTrustStore(): unknown;
  listEntries(): Promise<Array<{ path: string; decision: boolean }>>;
  set(path: string, decision: boolean | null): Promise<void>;
  hasTrustRequiringProjectResources(cwd: string): boolean;
  resolveProjectTrusted(input: unknown): Promise<boolean>;
};

export type PiDiagnosticsPort = { invalidate(): void };

export type PiRuntimeAdapter = {
  readonly metadata: PiRuntimeMetadata;
  readonly packageVersion: string;
  readonly packageRoot: string;
  readonly cliPath?: string;
  readonly cliVersion?: string;
  readonly capabilities: PiCapabilities;
  readonly compatibility: PiCompatibilityReport;
  readonly paths: PiPathPort;
  readonly runtime: PiRuntimePort;
  readonly sessions: PiSessionCatalogPort;
  readonly providers: PiProviderPort;
  readonly settings: PiSettingsPort;
  readonly packages: PiPackagePort;
  readonly resources: PiResourcePort;
  readonly trust: PiTrustPort;
  createEventBus(): PiEventBusHandle;
  readonly eventBus: PiEventBusPort;
  createRuntime(input: PiCreateRuntimeInput): Promise<PiRuntimeHandle>;
  dispose(runtime: PiRuntimeHandle): void;
};

export type PiRuntimeMetadata = {
  packageVersion: string;
  packageRoot: string;
  cliPath?: string;
  cliVersion?: string;
  nodePath?: string;
  nodeVersion?: string;
  npmPath?: string;
  npmVersion?: string;
  npmRoot?: string;
  generation: string;
};