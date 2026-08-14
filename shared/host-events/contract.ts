/**
 * Host events contract — Main → Renderer 的推送通道。
 * 机制移植自 ClawX shared/host-events/contract.ts，通道清单按 Pi Desktop 收敛。
 */
import type { PiRuntimeEventEnvelope } from '../pi-event-map';
import type {
  PiExtensionUiNotification,
  PiExtensionUiState,
  PiOAuthProgressEvent,
  PiPackageProgressEvent,
  PiRuntimeStateResult,
  PiUiRequestPayload,
} from '../host-api/contract';

export type PiInstallProgressEvent = {
  stream: 'stdout' | 'stderr' | 'status';
  text: string;
};

export type HostEventContract = {
  piSystem: {
    installProgress: (payload: PiInstallProgressEvent) => void;
  };
  piRuntime: {
    /** pi 会话事件（envelope 内含 sessionId/generation，渲染层据此丢弃过期事件） */
    event: (payload: PiRuntimeEventEnvelope) => void;
    /** new/switch/fork 后推送全量新状态，渲染层清空重载 */
    sessionReplaced: (payload: PiRuntimeStateResult) => void;
    /** 任一保活 runtime 的运行状态变化；会话列表据此刷新后台任务指示。 */
    runtimeStateChanged: (payload: { sessionPath?: string; running: boolean }) => void;
    /** 会话元数据变更（删除/归档/重命名/分叉）；侧栏与会话页据此即时刷新。 */
    sessionsChanged: (payload: { reason: 'remove' | 'archive' | 'rename' | 'fork' }) => void;
    /** 扩展 UI 请求（ctx.ui.confirm/select/input）：渲染层弹对话框，经 piRuntime.uiResponse 回传 */
    uiRequest: (payload: PiUiRequestPayload) => void;
    /** 扩展 UI 请求被取消（超时/signal abort/会话替换），渲染层移除对应对话框 */
    uiCancel: (payload: { requestId: string }) => void;
    /** 可序列化扩展 UI（状态、working 文案、文本 widget）的完整快照。 */
    uiState: (payload: PiExtensionUiState) => void;
    /** ctx.ui.notify 的壳内通知。 */
    uiNotification: (payload: PiExtensionUiNotification) => void;
  };
  providers: {
    /** OAuth 授权进度（授权 URL 等），由 pi provider-owned 流程发出 */
    oauthProgress: (payload: PiOAuthProgressEvent) => void;
  };
  piPackages: {
    /** 包安装/卸载/更新进度（PackageManager.setProgressCallback 转发） */
    progress: (payload: PiPackageProgressEvent) => void;
  };
  piMcp: {
    /** pi-mcp-adapter 状态快照（eventBus 通道 pi-mcp-adapter/status/v1 转发） */
    statusChanged: (payload: { snapshot: Record<string, unknown> | null }) => void;
  };
};

export type HostEventModule = keyof HostEventContract;
export type HostEventName<M extends HostEventModule> = keyof HostEventContract[M] & string;
export type HostEventHandler<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventContract[M][E];
export type HostEventArgs<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventHandler<M, E> extends (...args: infer Args) => void ? Args : never;

export const HOST_EVENT_CHANNELS = {
  piSystem: {
    installProgress: 'pi-system:install-progress',
  },
  piRuntime: {
    event: 'pi-runtime:event',
    sessionReplaced: 'pi-runtime:session-replaced',
    runtimeStateChanged: 'pi-runtime:runtime-state-changed',
    sessionsChanged: 'pi-runtime:sessions-changed',
    uiRequest: 'pi-runtime:ui-request',
    uiCancel: 'pi-runtime:ui-cancel',
    uiState: 'pi-runtime:ui-state',
    uiNotification: 'pi-runtime:ui-notification',
  },
  providers: {
    oauthProgress: 'providers:oauth-progress',
  },
  piPackages: {
    progress: 'pi-packages:progress',
  },
  piMcp: {
    statusChanged: 'pi-mcp:status-changed',
  },
} as const satisfies {
  [M in HostEventModule]: { [E in HostEventName<M>]: string };
};
