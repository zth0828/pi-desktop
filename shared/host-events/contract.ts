/**
 * Host events contract — Main → Renderer 的推送通道。
 */
import type { PiRuntimeEventEnvelope } from '../pi-event-map';
import type {
  PiExtensionUiNotification,
  PiExtensionUiState,
  PiEnvironment,
  PiOAuthProgressEvent,
  PiPackageProgressEvent,
  PiRuntimeStateResult,
  PiTrustListResult,
  PiTrustRequestPayload,
  PiUiRequestPayload,
} from '../host-api/contract';

export type PiInstallProgressEvent = {
  stream: 'stdout' | 'stderr' | 'status';
  text: string;
};

export type HostEventContract = {
  windows: {
    /** 目标窗口收到后激活包含该会话的面板。 */
    focusSession: (payload: { sessionPath: string }) => void;
  };
  appUpdate: {
    progress: (payload: import('../host-api/contract').AppUpdateProgressEvent) => void;
  };
  versionCheck: {
    updateAvailable: (payload: { current: string; latest: string; releaseUrl?: string; kind: 'app' | 'pi' }) => void;
  };
  piSystem: {
    installProgress: (payload: PiInstallProgressEvent) => void;
    /** 兼容性报告异步补齐后推送完整环境；主界面无需阻塞等待 SDK 加载。 */
    envChanged: (payload: PiEnvironment) => void;
  };
  piRuntime: {
    /** prompt request lifecycle, correlated by requestId and runtime generation */
    promptLifecycle: (payload: import('../host-api/contract').PiPromptLifecycleEvent) => void;

    event: (payload: PiRuntimeEventEnvelope) => void;
    /** new/switch/fork 后推送全量新状态，渲染层清空重载（payload 内含 sessionId，供按窗口绑定过滤） */
    sessionReplaced: (payload: PiRuntimeStateResult) => void;
    /** 任一保活 runtime 的运行状态变化；会话列表据此刷新后台任务指示（sessionId 供窗口过滤）。 */
    runtimeStateChanged: (payload: { sessionId: string; sessionPath?: string; running: boolean }) => void;
    /** 会话元数据变更（删除/归档/重命名/分叉/置顶）；侧栏与会话页据此即时刷新。 */
    sessionsChanged: (payload: { reason: 'remove' | 'archive' | 'rename' | 'fork' | 'pin' }) => void;

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
  piTrust: {
    /** 项目信任确认请求（启动/切换 cwd 时按需弹出；任一窗口响应即生效） */
    request: (payload: PiTrustRequestPayload) => void;
    /** 信任请求已定案（任一窗口响应后广播，其他窗口据此撤下对话框） */
    settled: (payload: { requestId: string }) => void;
    /** trust.json 记录被修改（Settings 页外部改动同步） */
    changed: (payload: PiTrustListResult) => void;
  };
  menu: {
    /** macOS 原生系统菜单栏业务项被点击（App.tsx 绑定后走与自绘菜单相同的 action） */
    action: (payload: { action: 'new-chat' | 'collapse-sidebar' | 'search-chats' }) => void;
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
  windows: {
    focusSession: 'windows:focus-session',
  },
  appUpdate: {
    progress: 'app-update:progress',
  },
  versionCheck: {
    updateAvailable: 'version-check:update-available',
  },
  piSystem: {
    installProgress: 'pi-system:install-progress',
    envChanged: 'pi-system:env-changed',
  },
  piRuntime: {
    promptLifecycle: 'pi-runtime:prompt-lifecycle',
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
  piTrust: {
    request: 'pi-trust:request',
    settled: 'pi-trust:settled',
    changed: 'pi-trust:changed',
  },
  menu: {
    action: 'menu:action',
  },
} as const satisfies {
  [M in HostEventModule]: { [E in HostEventName<M>]: string };
};
