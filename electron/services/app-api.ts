// app 模块：壳自身信息。
import { app } from 'electron';

export const appApi = {
  version: () => app.getVersion(),
  name: () => app.getName(),
  platform: () => process.platform,
};
