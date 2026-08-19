// settings 模块：壳自身设置（electron-store 持久化，仅存壳的设置；
// pi 的 settings.json 由 pi 的 SettingsManager 管，壳不碰）。
import type {
  SettingsSetPayload,
  SettingsSnapshot,
} from '@shared/host-api/contract';

type Store = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  // electron-store 是纯 ESM；主进程打包为 CJS，lazy dynamic import 加载
  storePromise ??= import('electron-store').then(
    (mod) => new mod.default<SettingsSnapshot>() as unknown as Store,
  );
  return storePromise;
}

export const settingsApi = {
  getAll: async (): Promise<SettingsSnapshot> => {
    const store = await getStore();
    return {
      language: store.get('language') as SettingsSnapshot['language'],
      workspaceCwd: store.get('workspaceCwd') as string | undefined,
      theme: store.get('theme') as SettingsSnapshot['theme'],
      notifyMode: store.get('notifyMode') as SettingsSnapshot['notifyMode'],
      followupBehavior: store.get('followupBehavior') as SettingsSnapshot['followupBehavior'],
      notifyUiRequest: store.get('notifyUiRequest') as SettingsSnapshot['notifyUiRequest'],
      preventSleep: store.get('preventSleep') as SettingsSnapshot['preventSleep'],
      sendWith: store.get('sendWith') as SettingsSnapshot['sendWith'],
      lastSessionExportPath: store.get('lastSessionExportPath') as SettingsSnapshot['lastSessionExportPath'],
      httpProxyMode: store.get('httpProxyMode') as SettingsSnapshot['httpProxyMode'],
      httpProxyUrl: store.get('httpProxyUrl') as SettingsSnapshot['httpProxyUrl'],
    };
  },
  get: async <K extends keyof SettingsSnapshot>(
    payload: { key: K },
  ): Promise<SettingsSnapshot[K]> => {
    const store = await getStore();
    return store.get(payload.key) as SettingsSnapshot[K];
  },
  set: async (payload: SettingsSetPayload) => {
    const store = await getStore();
    store.set(payload.key, payload.value);
    return { success: true };
  },
};
