// host-api 服务注册表：所有 Main 侧能力在此聚合。
// 渲染层只能通过 hostInvoke 触达这里（边界规则见 AGENTS.md）。
import type { HostServiceRegistry } from '../main/ipc/host-contract';
import { appApi } from './app-api';
import { shellApi } from './shell-api';

export function createHostServices(): HostServiceRegistry {
  return {
    app: appApi,
    shell: shellApi,
  };
}
