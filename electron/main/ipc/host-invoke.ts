// hostInvoke IPC 单通道：请求校验 + registry 分发（壳自身不做插件化，无扩展贡献注册）。
import { ipcMain } from 'electron';
import {
  type HostActionContext,
  type HostResponse,
  type HostServiceRegistry,
  type RuntimeHostAction,
  isHostRequest,
} from './host-contract';
import { resolveWindowSession } from '../window-manager';

export class HostApiRegistry {
  private modules = new Map<string, Map<string, RuntimeHostAction>>();

  registerCoreServices(services: HostServiceRegistry): void {
    for (const [moduleName, actions] of Object.entries(services)) {
      if (!actions || typeof actions !== 'object') continue;
      for (const [actionName, action] of Object.entries(actions)) {
        if (typeof action !== 'function') continue;
        this.registerAction(moduleName, actionName, action as RuntimeHostAction);
      }
    }
  }

  resolve(moduleName: string, actionName: string): RuntimeHostAction | undefined {
    return this.modules.get(moduleName)?.get(actionName);
  }

  private registerAction(moduleName: string, actionName: string, action: RuntimeHostAction): void {
    const moduleActions = this.modules.get(moduleName) ?? new Map<string, RuntimeHostAction>();
    if (moduleActions.has(actionName)) {
      throw new Error(`Host API action already registered: ${moduleName}.${actionName}`);
    }
    moduleActions.set(actionName, action);
    this.modules.set(moduleName, moduleActions);
  }
}

function toHostApiRegistry(registryOrServices: HostApiRegistry | HostServiceRegistry): HostApiRegistry {
  if (registryOrServices instanceof HostApiRegistry) {
    return registryOrServices;
  }
  const registry = new HostApiRegistry();
  registry.registerCoreServices(registryOrServices);
  return registry;
}

export function createHostInvokeDispatcher(registryOrServices: HostApiRegistry | HostServiceRegistry) {
  const registry = toHostApiRegistry(registryOrServices);
  return async function dispatchHostRequest(
    request: unknown,
    ctx?: HostActionContext,
  ): Promise<HostResponse> {
    const requestId = request && typeof request === 'object'
      ? String((request as Record<string, unknown>).id ?? '')
      : undefined;

    if (!isHostRequest(request)) {
      return {
        id: requestId,
        ok: false,
        error: { code: 'VALIDATION', message: 'Invalid host request format' },
      };
    }

    const action = registry.resolve(request.module, request.action);
    if (typeof action !== 'function') {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'UNSUPPORTED',
          message: `Unsupported host request: ${request.module}.${request.action}`,
        },
      };
    }

    try {
      const data = await action(request.payload, ctx);
      return { id: request.id, ok: true, data };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };
}

export function registerHostInvokeHandler(registry: HostApiRegistry): void {
  const dispatch = createHostInvokeDispatcher(registry);
  // sender → 窗口绑定会话，注入 action 的 ctx（sessionPath 查不到为 null）
  // 信封显式 sessionPath 优先于窗口绑定；都没有则 null 走全局 active
  ipcMain.handle('host:invoke', async (event, request: unknown) => {
    const explicit = request && typeof request === 'object'
      ? (request as { sessionPath?: unknown }).sessionPath
      : undefined;
    return dispatch(request, {
      sender: event.sender,
      sessionPath: typeof explicit === 'string' ? explicit : resolveWindowSession(event.sender.id),
    });
  });
}
