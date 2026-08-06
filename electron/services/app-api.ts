// app 模块：壳自身信息。
import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function resolveAppVersion(): string {
  const version = app.getVersion();
  // 开发模式（electron <entry> 启动）下 app path 指向 dist-electron/main，
  // getVersion() 会回退成 Electron 自身版本——此时读壳的 package.json
  if (version && version !== process.versions.electron) return version;
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(app.getAppPath(), '../../package.json'), 'utf8'),
    ) as { version?: string };
    return manifest.version ?? version;
  } catch {
    return version;
  }
}

export const appApi = {
  version: () => resolveAppVersion(),
  name: () => app.getName(),
  platform: () => process.platform,
};
