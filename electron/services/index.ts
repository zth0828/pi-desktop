// host-api 服务注册表：所有 Main 侧能力在此聚合。
// 渲染层只能通过 hostInvoke 触达这里（边界规则见 AGENTS.md）。
import type { HostServiceRegistry } from '../main/ipc/host-contract';
import { appApi } from './app-api';
import { dialogApi } from './dialog-api';
import { mcpApi } from './mcp-api';
import { packagesApi } from './packages-api';
import { piRuntimeApi } from './pi-runtime-api';
import { piSystemApi } from './pi-system-api';
import { providersApi } from './providers-api';
import { sessionsApi } from './sessions-api';
import { settingsApi } from './settings-api';
import { shellApi } from './shell-api';
import { skillsApi } from './skills-api';

export function createHostServices(): HostServiceRegistry {
  return {
    app: appApi,
    shell: shellApi,
    piSystem: piSystemApi,
    piRuntime: piRuntimeApi,
    providers: providersApi,
    piSessions: sessionsApi,
    piSkills: skillsApi,
    piPackages: packagesApi,
    piMcp: mcpApi,
    settings: settingsApi,
    dialog: dialogApi,
  };
}
