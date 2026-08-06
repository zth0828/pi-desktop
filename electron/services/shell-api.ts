// shell 模块：打开外部链接等系统交互。
import { shell } from 'electron';
import type { ShellOpenExternalPayload } from '@shared/host-api/contract';

export const shellApi = {
  openExternal: async (payload: ShellOpenExternalPayload) => {
    await shell.openExternal(payload.url);
  },
};
