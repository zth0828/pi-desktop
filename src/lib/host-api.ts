// Renderer 侧的 host-api 便捷封装：所有后端调用的唯一入口。
// 新能力 = contract.ts 加类型 + services/ 加实现 + 这里加一行。
import { invokeHost, scopedInvokeHost } from './host-api-client';
import type {
  AppEditCommand,
  DialogOpenPayload,
  DialogSavePayload,
  HostApiAction,
  HostApiModule,
  HostApiPayloadArgs,
  HostApiResult,
  SettingsSnapshot,
} from '@shared/host-api/contract';

// createHostApi(sessionPath) 产出面板作用域 client，
// 所有调用在信封带显式 sessionPath；缺省为窗口级调用，行为不变。
function createHostApi(sessionPath?: string) {
  function invoke<M extends HostApiModule, A extends HostApiAction<M>>(
    module: M,
    action: A,
    ...payloadArgs: HostApiPayloadArgs<M, A>
  ): Promise<HostApiResult<M, A>> {
    return sessionPath === undefined
      ? invokeHost(module, action, ...payloadArgs)
      : scopedInvokeHost(sessionPath, module, action, ...payloadArgs);
  }

  return {
  app: {
    version: () => invoke('app', 'version'),
    name: () => invoke('app', 'name'),
    platform: () => invoke('app', 'platform'),
    writeClipboard: (text: string) => invoke('app', 'writeClipboard', { text }),
    writeClipboardImage: (payload: { data: string; mimeType?: string }) =>
      invoke('app', 'writeClipboardImage', payload),
    writeBinaryFile: (payload: { path: string; data: string }) =>
      invoke('app', 'writeBinaryFile', payload),
    editCommand: (command: AppEditCommand) => invoke('app', 'editCommand', { command }),
  },
  shell: {
    openExternal: (url: string) => invoke('shell', 'openExternal', { url }),
    listApplications: () => invoke('shell', 'listApplications'),
    openPath: (path: string) => invoke('shell', 'openPath', { path }),
    openPathWith: (path: string, application: { id: string; name: string; path: string; iconDataUrl?: string }) =>
      invoke('shell', 'openPathWith', { path, application }),
    showInFolder: (path: string) => invoke('shell', 'showInFolder', { path }),
  },
  piSystem: {
    detect: (force?: boolean) => invoke('piSystem', 'detect', force ? { force } : undefined),
    checkLatest: () => invoke('piSystem', 'checkLatest'),
    install: () => invoke('piSystem', 'install'),
  },
  versionCheck: {
    check: (force?: boolean) => invoke('versionCheck', 'check', force ? { force } : undefined),
    getStatus: () => invoke('versionCheck', 'getStatus'),
  },
  appUpdate: {
    download: () => invoke('appUpdate', 'download'),
    openDownloaded: () => invoke('appUpdate', 'openDownloaded'),
    showDownloaded: () => invoke('appUpdate', 'showDownloaded'),
    installDownloaded: (force?: boolean) => invoke('appUpdate', 'installDownloaded', force ? { force } : undefined),
  },
  piRuntime: {
    start: (cwd: string) => invoke('piRuntime', 'start', { cwd }),
    getState: () => invoke('piRuntime', 'getState'),
    getContextUsage: () => invoke('piRuntime', 'getContextUsage'),
    getUsage: () => invoke('piRuntime', 'getUsage'),
    prompt: (text: string, images?: unknown[], behavior?: 'steer' | 'followUp') =>
      invoke('piRuntime', 'prompt', { text, images, behavior }),
    abort: () => invoke('piRuntime', 'abort'),
    queueRemove: (kind: 'steering' | 'followUp', index: number) =>
      invoke('piRuntime', 'queueRemove', { kind, index }),
    queueMove: (kind: 'steering' | 'followUp', index: number, target: 'steering' | 'followUp') =>
      invoke('piRuntime', 'queueMove', { kind, index, target }),
    newSession: () => invoke('piRuntime', 'newSession'),
    compact: (customInstructions?: string) =>
      invoke('piRuntime', 'compact', customInstructions ? { customInstructions } : undefined),
    fork: (entryId: string) => invoke('piRuntime', 'fork', { entryId }),
    getTree: () => invoke('piRuntime', 'getTree'),
    navigateTree: (targetId: string, options?: { summarize?: boolean; customInstructions?: string }) =>
      invoke('piRuntime', 'navigateTree', { targetId, ...options }),
    setThinkingLevel: (level: string) => invoke('piRuntime', 'setThinkingLevel', { level }),
    setModel: (provider: string, id: string) => invoke('piRuntime', 'setModel', { provider, id }),
    setSessionName: (name: string, notify = true) => invoke('piRuntime', 'setSessionName', { name, notify }),
    getSessionInfo: () => invoke('piRuntime', 'getSessionInfo'),
    reload: () => invoke('piRuntime', 'reload'),
    exportHtml: (outputPath?: string) =>
      invoke('piRuntime', 'exportHtml', outputPath ? { outputPath } : undefined),
    getCommands: () => invoke('piRuntime', 'getCommands'),
    executeBash: (payload: { command: string; excludeFromContext?: boolean }) =>
      invoke('piRuntime', 'executeBash', payload),
    uiResponse: (payload: { requestId: string; value?: string | boolean; cancelled?: boolean }) =>
      invoke('piRuntime', 'uiResponse', payload),
  },
  providers: {
    list: () => invoke('providers', 'list'),
    listModels: () => invoke('providers', 'listModels'),
    refresh: () => invoke('providers', 'refresh'),
    setApiKey: (providerId: string, apiKey: string) =>
      invoke('providers', 'setApiKey', { providerId, apiKey }),
    removeCredential: (providerId: string) =>
      invoke('providers', 'removeCredential', { providerId }),
    deleteCustom: (providerId: string) =>
      invoke('providers', 'deleteCustom', { providerId }),
    startOAuth: (providerId: string) => invoke('providers', 'startOAuth', { providerId }),
    addCustom: (payload: {
      id: string;
      baseUrl: string;
      api: string;
      apiKey?: string;
      serverType?: 'lm-studio' | 'vllm' | 'generic';
      models: Array<{
        id: string;
        name?: string;
        reasoning?: boolean;
        contextWindow?: number;
        maxTokens?: number;
        thinkingLevelMap?: Record<string, string | null>;
      }>;
    }) => invoke('providers', 'addCustom', payload),
    setModelReasoning: (providerId: string, modelId: string, reasoning: boolean) =>
      invoke('providers', 'setModelReasoning', { providerId, modelId, reasoning }),
    probe: (payload: { baseUrl: string; apiKey?: string; model?: string; verifyProtocols?: boolean }) =>
      invoke('providers', 'probe', payload),
    getCompaction: () => invoke('providers', 'getCompaction'),
    setCompaction: (payload: { reserveTokens?: number; keepRecentTokens?: number; enabled?: boolean }) =>
      invoke('providers', 'setCompaction', payload),
    getRetry: () => invoke('providers', 'getRetry'),
    setRetry: (payload: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }) =>
      invoke('providers', 'setRetry', payload),
    getDefaultThinking: () => invoke('providers', 'getDefaultThinking'),
    setDefaultThinking: (level: string) => invoke('providers', 'setDefaultThinking', { level }),
    getDefaultModel: () => invoke('providers', 'getDefaultModel'),
    setDefaultModel: (provider: string, id: string) =>
      invoke('providers', 'setDefaultModel', { provider, id }),
  },
  piSessions: {
    list: () => invoke('piSessions', 'list'),
    listAll: () => invoke('piSessions', 'listAll'),
    search: (query: string, limit?: number) => invoke('piSessions', 'search', { query, limit }),
    switch: (path: string, cwd?: string) => invoke('piSessions', 'switch', { path, cwd }),
    rename: (path: string, name: string) => invoke('piSessions', 'rename', { path, name }),
    fork: (path: string) => invoke('piSessions', 'fork', { path }),
    archive: (path: string, archived: boolean) =>
      invoke('piSessions', 'archive', { path, archived }),
    archiveProject: (cwd: string, archived: boolean) =>
      invoke('piSessions', 'archiveProject', { cwd, archived }),
    remove: (path: string) => invoke('piSessions', 'remove', { path }),
    exportHtml: (path: string) => invoke('piSessions', 'exportHtml', { path }),
    getExportInfo: () => invoke('piSessions', 'getExportInfo'),
  },
  piSkills: {
    list: () => invoke('piSkills', 'list'),
    read: (filePath: string) => invoke('piSkills', 'read', { filePath }),
    scanExternal: (extraDirs?: string[]) => invoke('piSkills', 'scanExternal', { extraDirs }),
    import: (skills: Array<{ name: string; dir: string; strategy: 'skip' | 'overwrite' | 'rename' }>) =>
      invoke('piSkills', 'import', { skills }),
  },
  piFiles: {
    list: (cwd: string) => invoke('piFiles', 'list', { cwd }),
  },
  piPackages: {
    list: () => invoke('piPackages', 'list'),
    install: (source: string) => invoke('piPackages', 'install', { source }),
    remove: (source: string, scope: 'user' | 'project') =>
      invoke('piPackages', 'remove', { source, scope }),
    update: (source?: string) => invoke('piPackages', 'update', { source }),
    checkUpdates: () => invoke('piPackages', 'checkUpdates'),
    catalog: (query: {
      name?: string;
      type?: '' | 'extension' | 'skill' | 'theme' | 'prompt';
      sort?: 'downloads' | 'recent' | 'name';
      page?: number;
      refresh?: boolean;
    }) => invoke('piPackages', 'catalog', query),
    detail: (name: string, refresh = false) =>
      invoke('piPackages', 'detail', { name, refresh }),
  },
  piMcp: {
    list: () => invoke('piMcp', 'list'),
    upsert: (payload: {
      scope: 'global' | 'project';
      name: string;
      originalName?: string;
      config: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
        disabled?: boolean;
        lifecycle?: string;
      };
    }) => invoke('piMcp', 'upsert', payload),
    remove: (scope: 'global' | 'project', name: string) =>
      invoke('piMcp', 'remove', { scope, name }),
    setDisabled: (scope: 'global' | 'project', name: string, disabled: boolean) =>
      invoke('piMcp', 'setDisabled', { scope, name, disabled }),
    installAdapter: () => invoke('piMcp', 'installAdapter'),
  },
  piTrust: {
    listPending: () => invoke('piTrust', 'listPending'),
    respond: (requestId: string, label?: string) => invoke('piTrust', 'respond', { requestId, label }),
    list: () => invoke('piTrust', 'list'),
    set: (path: string, decision: boolean | null) => invoke('piTrust', 'set', { path, decision }),
  },
  settings: {
    getAll: () => invoke('settings', 'getAll'),
    get: <K extends keyof SettingsSnapshot>(key: K) =>
      invoke('settings', 'get', { key }) as Promise<SettingsSnapshot[K]>,
    set: (key: keyof SettingsSnapshot, value: string | number | boolean | undefined) =>
      invoke('settings', 'set', { key, value }),
  },
  proxy: {
    detect: () => invoke('proxy', 'detect'),
    apply: () => invoke('proxy', 'apply'),
  },
  notify: {
    dispatch: (payload: { kind: 'runCompleted' | 'uiRequest'; title: string; body?: string }) =>
      invoke('notify', 'dispatch', payload),
  },
  review: {
    getSummary: () => invoke('review', 'getSummary'),
    getFileDiff: (path: string) => invoke('review', 'getFileDiff', { path }),
    revertFile: (path: string) => invoke('review', 'revertFile', { path }),
    revertHunk: (path: string, patch: string) =>
      invoke('review', 'revertHunk', { path, patch }),
  },
  workspace: {
    listChildren: (path = '') => invoke('workspace', 'listChildren', { path }),
    readFile: (path: string) => invoke('workspace', 'readFile', { path }),
  },
  git: {
    getBranch: (cwd: string) => invoke('git', 'getBranch', { cwd }),
    listBranches: (cwd: string) => invoke('git', 'listBranches', { cwd }),
    checkout: (cwd: string, branch: string) => invoke('git', 'checkout', { cwd, branch }),
  },
  dialog: {
    open: (payload: DialogOpenPayload) => invoke('dialog', 'open', payload),
    openDirectory: (title?: string, defaultPath?: string) =>
      invoke('dialog', 'open', { title, defaultPath, properties: ['openDirectory', 'createDirectory'] }),
    save: (payload: DialogSavePayload) => invoke('dialog', 'save', payload),
    saveFile: (payload?: DialogSavePayload) => invoke('dialog', 'save', payload ?? {}),
  },
  windows: {
    openDetached: (payload: { sessionPath: string; cwd?: string }) =>
      invoke('windows', 'openDetached', payload),
    openDetachedAt: (payload: { sessionPath: string; cwd?: string; screenX: number; screenY: number }) =>
      invoke('windows', 'openDetachedAt', payload),
    focus: (sessionPath: string) => invoke('windows', 'focus', { sessionPath }),
    focusIfOpen: (sessionPath: string) => invoke('windows', 'focusIfOpen', { sessionPath }),
    setSessions: (payload: { sessionPaths: string[]; activeSessionPath?: string }) =>
      invoke('windows', 'setSessions', payload),
    list: () => invoke('windows', 'list'),
    minimize: () => invoke('windows', 'minimize'),
    maximizeToggle: () => invoke('windows', 'maximizeToggle'),
    isMaximized: () => invoke('windows', 'isMaximized'),
    close: () => invoke('windows', 'close'),
  },
  };
}

export type HostApi = ReturnType<typeof createHostApi>;

export const hostApi = createHostApi();

// 面板作用域 client：同 sessionPath 返回同一对象（Map 缓存，保证渲染期引用稳定）。
const scopedApis = new Map<string, HostApi>();
export function scopedHostApi(sessionPath: string): HostApi {
  let api = scopedApis.get(sessionPath);
  if (!api) {
    api = createHostApi(sessionPath);
    scopedApis.set(sessionPath, api);
  }
  return api;
}
