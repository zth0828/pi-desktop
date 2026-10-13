import { create } from 'zustand';
import { hostApi } from '../lib/host-api';

type CompanionState = {
  initialized: boolean;
  askQuestionInstalled: boolean;
  subagentsInstalled: boolean;
  loading: boolean;
  subagentsLoading: boolean;
  error?: string;
  fetchStatus: (id?: string) => Promise<boolean>;
  fetchSubagentsStatus: () => Promise<boolean>;
  fetchAllStatus: () => Promise<void>;
  installSubagents: () => Promise<boolean>;
  toggle: (id: string, enable: boolean) => Promise<boolean>;
};

export const useCompanionStore = create<CompanionState>((set) => ({
  initialized: false,
  askQuestionInstalled: false,
  subagentsInstalled: false,
  loading: false,
  subagentsLoading: false,
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

  fetchSubagentsStatus: async () => {
    try {
      const res = await hostApi.piPackages.list();
      const installed = Array.isArray(res?.packages) && res.packages.some(
        (p) => p.name?.includes('subagent') || (typeof p.source === 'string' && p.source.includes('subagent')),
      );
      set({ subagentsInstalled: installed });
      return installed;
    } catch {
      return false;
    }
  },

  fetchAllStatus: async () => {
    try {
      await Promise.allSettled([
        useCompanionStore.getState().fetchStatus('ask-question'),
        useCompanionStore.getState().fetchSubagentsStatus(),
      ]);
      set({ initialized: true });
    } catch {
      set({ initialized: true });
    }
  },

  installSubagents: async () => {
    set({ subagentsLoading: true, error: undefined });
    try {
      const res = await hostApi.piPackages.install('npm:pi-subagents');
      if (res.success) {
        await hostApi.piRuntime.reload().catch(() => {});
        set({ subagentsInstalled: true, subagentsLoading: false });
        return true;
      }
      set({ subagentsLoading: false, error: res.error });
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ subagentsLoading: false, error: message });
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
