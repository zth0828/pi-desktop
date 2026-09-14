import { create } from 'zustand';
import { hostApi } from '../lib/host-api';

type CompanionState = {
  askQuestionInstalled: boolean;
  loading: boolean;
  error?: string;
  fetchStatus: (id?: string) => Promise<boolean>;
  toggle: (id: string, enable: boolean) => Promise<boolean>;
};

export const useCompanionStore = create<CompanionState>((set) => ({
  askQuestionInstalled: false,
  loading: false,
  error: undefined,

  fetchStatus: async (id = 'ask-question') => {
    try {
      const res = await hostApi.piPackages.getCompanionStatus(id);
      if (id === 'ask-question') {
        set({ askQuestionInstalled: res.installed });
      }
      return res.installed;
    } catch {
      return false;
    }
  },

  toggle: async (id: string, enable: boolean) => {
    set({ loading: true, error: undefined });
    try {
      const res = await hostApi.piPackages.toggleCompanion(id, enable);
      if (res.success) {
        if (id === 'ask-question') {
          set({ askQuestionInstalled: res.installed, loading: false });
        } else {
          set({ loading: false });
        }
        return true;
      }
      set({ loading: false, error: res.error });
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return false;
    }
  },
}));
