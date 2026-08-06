// Renderer 侧的 host-api 便捷封装：所有后端调用的唯一入口（AGENTS.md 边界规则）。
// 新能力 = contract.ts 加类型 + services/ 加实现 + 这里加一行。
import { invokeHost } from './host-api-client';

export const hostApi = {
  app: {
    version: () => invokeHost('app', 'version'),
    name: () => invokeHost('app', 'name'),
    platform: () => invokeHost('app', 'platform'),
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
    prompt: (text: string, images?: unknown[]) =>
      invokeHost('piRuntime', 'prompt', { text, images }),
    abort: () => invokeHost('piRuntime', 'abort'),
    newSession: () => invokeHost('piRuntime', 'newSession'),
    compact: () => invokeHost('piRuntime', 'compact'),
    setThinkingLevel: (level: string) => invokeHost('piRuntime', 'setThinkingLevel', { level }),
    setModel: (provider: string, id: string) => invokeHost('piRuntime', 'setModel', { provider, id }),
    getCommands: () => invokeHost('piRuntime', 'getCommands'),
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
  },
  settings: {
    getAll: () => invokeHost('settings', 'getAll'),
    get: (key: 'language' | 'workspaceCwd') => invokeHost('settings', 'get', { key }),
    set: (key: 'language' | 'workspaceCwd', value: string | undefined) =>
      invokeHost('settings', 'set', { key, value }),
  },
  dialog: {
    openDirectory: (title?: string, defaultPath?: string) =>
      invokeHost('dialog', 'open', { title, defaultPath, properties: ['openDirectory', 'createDirectory'] }),
  },
};
