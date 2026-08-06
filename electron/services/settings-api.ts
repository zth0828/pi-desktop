// settings 模块：壳自身设置（electron-store 持久化，仅存壳的设置；
// pi 的 settings.json 由 pi 的 SettingsManager 管，壳不碰）。
import type {
  SettingsGetPayload,
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
    };
  },
  get: async (payload: SettingsGetPayload) => {
    const store = await getStore();
    return store.get(payload.key) as string | undefined;
  },
  set: async (payload: SettingsSetPayload) => {
    const store = await getStore();
    store.set(payload.key, payload.value);
    return { success: true };
  },
};
