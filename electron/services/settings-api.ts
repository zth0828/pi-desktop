import type {
  SettingsSetPayload,
  SettingsSnapshot,
} from '@shared/host-api/contract';
import { getElectronStore } from '../utils/electron-store';
import { riskyWorkspaceReason } from '../utils/workspace-safety';
import { rebuildNativeMacMenu } from '../main/menu';

export const settingsApi = {
  getAll: async (): Promise<SettingsSnapshot> => {
    const store = await getElectronStore();
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
      piVersionCheckLastAttemptAt: store.get('piVersionCheckLastAttemptAt') as number | undefined,
      piVersionCheckLastSuccessAt: store.get('piVersionCheckLastSuccessAt') as number | undefined,
      piVersionCheckLatest: store.get('piVersionCheckLatest') as string | undefined,
      piVersionCheckError: store.get('piVersionCheckError') as string | undefined,
      appVersionCheckLastAttemptAt: store.get('appVersionCheckLastAttemptAt') as number | undefined,
      appVersionCheckLastSuccessAt: store.get('appVersionCheckLastSuccessAt') as number | undefined,
      appVersionCheckLatest: store.get('appVersionCheckLatest') as string | undefined,
      appVersionCheckError: store.get('appVersionCheckError') as string | undefined,
      appVersionCheckReleaseUrl: store.get('appVersionCheckReleaseUrl') as string | undefined,
      appVersionCheckAssetName: store.get('appVersionCheckAssetName') as string | undefined,
      appVersionCheckDownloadedPath: store.get('appVersionCheckDownloadedPath') as string | undefined,
    };
  },
  get: async <K extends keyof SettingsSnapshot>(
    payload: { key: K },
  ): Promise<SettingsSnapshot[K]> => {
    const store = await getElectronStore();
    return store.get(payload.key) as SettingsSnapshot[K];
  },
  set: async (payload: SettingsSetPayload) => {
    const store = await getElectronStore();
    // 工作区安全：主目录 / 盘符根不能作为持久化工作区（agent 会扫描个人全部文件）。
    // 这里拒绝写入，两个 UI 入口（Chat 空态选择 / 设置页）都会拿到失败并提示。
    if (payload.key === 'workspaceCwd' && typeof payload.value === 'string') {
      const risky = riskyWorkspaceReason(payload.value);
      if (risky) return { success: false, error: `risky-workspace-${risky}` };
    }
    if (payload.value === undefined) store.delete(payload.key);
    else store.set(payload.key, payload.value);
    // macOS 原生菜单文案跟随应用语言设置（与 Windows 自绘菜单 react-i18next
    // 即时切换对齐）；重建是幂等的，非 darwin 下菜单函数内部直接忽略。
    if (payload.key === 'language' && process.platform === 'darwin') {
      void rebuildNativeMacMenu().catch((error) => {
        console.error('[menu] failed to rebuild native menu on language change', error);
      });
    }
    return { success: true };
  },
};
