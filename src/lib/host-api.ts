// Renderer 侧的 host-api 便捷封装：所有后端调用的唯一入口（AGENTS.md 边界规则）。
// 新能力 = contract.ts 加类型 + services/ 加实现 + 这里加一行。
import { invokeHost } from './host-api-client';

export const hostApi = {
  app: {
    version: () => invokeHost('app', 'version'),
    name: () => invokeHost('app', 'name'),
    platform: () => invokeHost('app', 'platform'),
  },
  shell: {
    openExternal: (url: string) => invokeHost('shell', 'openExternal', { url }),
  },
  piSystem: {
    detect: (force?: boolean) => invokeHost('piSystem', 'detect', force ? { force } : undefined),
    checkLatest: () => invokeHost('piSystem', 'checkLatest'),
    install: () => invokeHost('piSystem', 'install'),
  },
};
