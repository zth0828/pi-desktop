import type { SettingsSnapshot } from '@shared/host-api/contract';

type ElectronStore = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

let storePromise: Promise<ElectronStore> | null = null;

/** All shell persistence uses one electron-store instance to avoid config.json overwrites. */
export function getElectronStore(): Promise<ElectronStore> {
  storePromise ??= import('electron-store').then(
    (mod) => new mod.default<SettingsSnapshot>() as unknown as ElectronStore,
  );
  return storePromise;
}
