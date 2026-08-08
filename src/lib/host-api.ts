// Renderer 侧的 host-api 便捷封装：所有后端调用的唯一入口（AGENTS.md 边界规则）。
// 新能力 = contract.ts 加类型 + services/ 加实现 + 这里加一行。
import { invokeHost } from './host-api-client';

export const hostApi = {
  app: {
    version: () => invokeHost('app', 'version'),
    name: () => invokeHost('app', 'name'),
    platform: () => invokeHost('app', 'platform'),
    writeClipboard: (text: string) => invokeHost('app', 'writeClipboard', { text }),
  },
  shell: {
    openExternal: (url: string) => invokeHost('shell', 'openExternal', { url }),
  },
  piSystem: {
    detect: (force?: boolean) => invokeHost('piSystem', 'detect', force ? { force } : undefined),
    checkLatest: () => invokeHost('piSystem', 'checkLatest'),
    install: () => invokeHost('piSystem', 'install'),
  },
  piRuntime: {
    start: (cwd: string) => invokeHost('piRuntime', 'start', { cwd }),
    getState: () => invokeHost('piRuntime', 'getState'),
    getContextUsage: () => invokeHost('piRuntime', 'getContextUsage'),
    prompt: (text: string, images?: unknown[], behavior?: 'steer' | 'followUp') =>
      invokeHost('piRuntime', 'prompt', { text, images, behavior }),
    abort: () => invokeHost('piRuntime', 'abort'),
    queueRemove: (kind: 'steering' | 'followUp', index: number) =>
      invokeHost('piRuntime', 'queueRemove', { kind, index }),
    queueSteerNow: (kind: 'steering' | 'followUp', index: number) =>
      invokeHost('piRuntime', 'queueSteerNow', { kind, index }),
    newSession: () => invokeHost('piRuntime', 'newSession'),
    compact: (customInstructions?: string) =>
      invokeHost('piRuntime', 'compact', customInstructions ? { customInstructions } : undefined),
    fork: (entryId: string) => invokeHost('piRuntime', 'fork', { entryId }),
    getTree: () => invokeHost('piRuntime', 'getTree'),
    navigateTree: (targetId: string) => invokeHost('piRuntime', 'navigateTree', { targetId }),
    setThinkingLevel: (level: string) => invokeHost('piRuntime', 'setThinkingLevel', { level }),
    setModel: (provider: string, id: string) => invokeHost('piRuntime', 'setModel', { provider, id }),
    setSessionName: (name: string) => invokeHost('piRuntime', 'setSessionName', { name }),
    getSessionInfo: () => invokeHost('piRuntime', 'getSessionInfo'),
    reload: () => invokeHost('piRuntime', 'reload'),
    exportHtml: (outputPath?: string) =>
      invokeHost('piRuntime', 'exportHtml', outputPath ? { outputPath } : undefined),
    getCommands: () => invokeHost('piRuntime', 'getCommands'),
    uiResponse: (payload: { requestId: string; value?: string | boolean; cancelled?: boolean }) =>
      invokeHost('piRuntime', 'uiResponse', payload),
  },
  providers: {
    list: () => invokeHost('providers', 'list'),
    listModels: () => invokeHost('providers', 'listModels'),
    setApiKey: (providerId: string, apiKey: string) =>
      invokeHost('providers', 'setApiKey', { providerId, apiKey }),
    removeCredential: (providerId: string) =>
      invokeHost('providers', 'removeCredential', { providerId }),
    startOAuth: (providerId: string) => invokeHost('providers', 'startOAuth', { providerId }),
    addCustom: (payload: {
      id: string;
      baseUrl: string;
      api: string;
      apiKey?: string;
      models: Array<{ id: string; name?: string }>;
    }) => invokeHost('providers', 'addCustom', payload),
    getDefaultModel: () => invokeHost('providers', 'getDefaultModel'),
    setDefaultModel: (provider: string, id: string) =>
      invokeHost('providers', 'setDefaultModel', { provider, id }),
  },
  piSessions: {
    list: () => invokeHost('piSessions', 'list'),
    listAll: () => invokeHost('piSessions', 'listAll'),
    switch: (path: string, cwd?: string) => invokeHost('piSessions', 'switch', { path, cwd }),
    rename: (path: string, name: string) => invokeHost('piSessions', 'rename', { path, name }),
    fork: (path: string) => invokeHost('piSessions', 'fork', { path }),
    archive: (path: string, archived: boolean) =>
      invokeHost('piSessions', 'archive', { path, archived }),
    archiveProject: (cwd: string, archived: boolean) =>
      invokeHost('piSessions', 'archiveProject', { cwd, archived }),
    remove: (path: string) => invokeHost('piSessions', 'remove', { path }),
    exportHtml: (path: string) => invokeHost('piSessions', 'exportHtml', { path }),
  },
  piSkills: {
    list: () => invokeHost('piSkills', 'list'),
  },
  piFiles: {
    list: (cwd: string) => invokeHost('piFiles', 'list', { cwd }),
  },
  piPackages: {
    list: () => invokeHost('piPackages', 'list'),
    install: (source: string) => invokeHost('piPackages', 'install', { source }),
    remove: (source: string, scope: 'user' | 'project') =>
      invokeHost('piPackages', 'remove', { source, scope }),
    update: (source?: string) => invokeHost('piPackages', 'update', { source }),
    checkUpdates: () => invokeHost('piPackages', 'checkUpdates'),
    catalog: (query: {
      name?: string;
      type?: '' | 'extension' | 'skill' | 'theme' | 'prompt';
      sort?: 'downloads' | 'recent' | 'name';
      page?: number;
      refresh?: boolean;
    }) => invokeHost('piPackages', 'catalog', query),
    detail: (name: string, refresh = false) =>
      invokeHost('piPackages', 'detail', { name, refresh }),
  },
  piMcp: {
    list: () => invokeHost('piMcp', 'list'),
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
    }) => invokeHost('piMcp', 'upsert', payload),
    remove: (scope: 'global' | 'project', name: string) =>
      invokeHost('piMcp', 'remove', { scope, name }),
    setDisabled: (scope: 'global' | 'project', name: string, disabled: boolean) =>
      invokeHost('piMcp', 'setDisabled', { scope, name, disabled }),
    installAdapter: () => invokeHost('piMcp', 'installAdapter'),
  },
  settings: {
    getAll: () => invokeHost('settings', 'getAll'),
    get: (key: 'language' | 'workspaceCwd' | 'theme' | 'notifyMode') =>
      invokeHost('settings', 'get', { key }),
    set: (key: 'language' | 'workspaceCwd' | 'theme' | 'notifyMode', value: string | undefined) =>
      invokeHost('settings', 'set', { key, value }),
  },
  notify: {
    dispatch: (payload: { kind: 'runCompleted' | 'uiRequest'; title: string; body?: string }) =>
      invokeHost('notify', 'dispatch', payload),
  },
  review: {
    getSummary: () => invokeHost('review', 'getSummary'),
    getFileDiff: (path: string) => invokeHost('review', 'getFileDiff', { path }),
    revertFile: (path: string) => invokeHost('review', 'revertFile', { path }),
    revertHunk: (path: string, patch: string) =>
      invokeHost('review', 'revertHunk', { path, patch }),
  },
  dialog: {
    openDirectory: (title?: string, defaultPath?: string) =>
      invokeHost('dialog', 'open', { title, defaultPath, properties: ['openDirectory', 'createDirectory'] }),
  },
};
