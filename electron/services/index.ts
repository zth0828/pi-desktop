// host-api 服务注册表：所有 Main 侧能力在此聚合。
// 渲染层只能通过 hostInvoke 触达这里。
import type { HostServiceRegistry } from '../main/ipc/host-contract';
import { appUpdateApi } from './app-update-api';
import { appApi } from './app-api';
import { dialogApi } from './dialog-api';
import { filesApi } from './files-api';
import { gitApi } from './git-api';
import { mcpApi } from './mcp-api';
import { notifyApi } from './notify-api';
import { packagesApi } from './packages-api';
import { piRuntimeApi } from './pi-runtime-api';
import { piSystemApi } from './pi-system-api';
import { projectTrustApi } from './project-trust';
import { providersApi } from './providers-api';
import { proxyApi } from './proxy-api';
import { reviewApi } from './review-api';
import { sessionsApi } from './sessions-api';
import { settingsApi } from './settings-api';
import { shellApi } from './shell-api';
import { skillsApi } from './skills-api';
import { windowsApi } from './windows-api';
import { versionCheckApi } from './version-check-api';
import { workspaceApi } from './workspace-api';

export function createHostServices(): HostServiceRegistry {
  return {
    app: appApi,
    shell: shellApi,
    piSystem: piSystemApi,
    versionCheck: versionCheckApi,
    appUpdate: appUpdateApi,
    piRuntime: piRuntimeApi,
    providers: providersApi,
    proxy: proxyApi,
    piSessions: sessionsApi,
    piSkills: skillsApi,
    piPackages: packagesApi,
    piMcp: mcpApi,
    piTrust: projectTrustApi,
    piFiles: filesApi,
    settings: settingsApi,
    dialog: dialogApi,
    notify: notifyApi,
    review: reviewApi,
    windows: windowsApi,
    workspace: workspaceApi,
    git: gitApi,
  };
}
