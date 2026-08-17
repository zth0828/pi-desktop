// 项目信任：pi ProjectTrustStore 的壳侧桥接。
// 判定逻辑（哪些资源需要信任、选项集、保存语义）全部在 pi 侧
// （hasTrustRequiringProjectResources / getProjectTrustOptions / resolveProjectTrusted）；
// 这里只提供 UI 通道（renderer 选择框）与 Settings 页的记录管理。
// 信任确认不绑定会话（发生在 runtime 创建早期，sessionId 尚未存在），
// 因此独立于 extension-ui 的 uiRequest 通道：广播事件 + listPending 拉取兜底。
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  HostSuccess,
  PiTrustEntry,
  PiTrustListResult,
  PiTrustRequestPayload,
  PiTrustRespondPayload,
  PiTrustSetPayload,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiProjectTrust, loadPiSdk, type PiSdk } from '../utils/pi-loader';
import { parseTrustEntries } from '../utils/trust-entries';

type PendingTrustRequest = {
  payload: PiTrustRequestPayload;
  resolve: (label: string | undefined) => void;
};

const pending = new Map<string, PendingTrustRequest>();

function settle(requestId: string, label: string | undefined): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  sendHostEvent('piTrust', 'settled', { requestId });
  entry.resolve(label);
}

/**
 * pi resolveProjectTrusted 的 ctx.ui.select 实现：把 pi 原生选项集推到渲染层。
 * 用户取消（关窗/不选）→ undefined → pi 按不信任处理（不落记录）。
 * 无超时，与 pi TUI 一致（等用户作答）；任一窗口响应后其余窗口的对话框经 settled 事件撤下。
 */
export function requestTrustSelection(
  cwd: string,
  title: string,
  options: string[],
): Promise<string | undefined> {
  const requestId = randomUUID();
  const payload: PiTrustRequestPayload = { requestId, cwd, title, options };
  return new Promise((resolve) => {
    pending.set(requestId, { payload, resolve });
    sendHostEvent('piTrust', 'request', payload);
  });
}

/** resolveProjectTrusted 的 ProjectTrustContext：select 走渲染层，其余按 print 模式安全降级。 */
export function createShellTrustContext(cwd: string) {
  return {
    cwd,
    mode: 'print' as const,
    hasUI: true,
    ui: {
      select: (title: string, options: string[]) => requestTrustSelection(cwd, title, options),
      confirm: async () => false,
      input: async () => undefined,
      notify: () => {},
    },
  };
}

async function trustStore(): Promise<InstanceType<PiSdk['ProjectTrustStore']>> {
  const sdk = await loadPiSdk();
  return new sdk.ProjectTrustStore(sdk.getAgentDir());
}

/** trust.json 直读：ProjectTrustStore 无全量列举 API（文件格式即 path→decision 的 JSON 对象）。 */
async function listEntries(): Promise<PiTrustEntry[]> {
  const sdk = await loadPiSdk();
  const trustPath = path.join(sdk.getAgentDir(), 'trust.json');
  try {
    return parseTrustEntries(readFileSync(trustPath, 'utf8'));
  } catch {
    return [];
  }
}

export const projectTrustApi = {
  listPending: (): PiTrustRequestPayload[] => [...pending.values()].map((entry) => entry.payload),

  respond: (payload: PiTrustRespondPayload): HostSuccess => {
    settle(payload.requestId, payload.label);
    return { success: true };
  },

  list: async (): Promise<PiTrustListResult> => ({ entries: await listEntries() }),

  set: async (payload: PiTrustSetPayload): Promise<HostSuccess> => {
    const store = await trustStore();
    store.set(payload.path, payload.decision);
    sendHostEvent('piTrust', 'changed', { entries: await listEntries() });
    return { success: true };
  },
};

/** pi resolveProjectTrusted 的壳侧入口（重导出，调用点集中在 pi-runtime-api）。 */
export async function resolveProjectTrusted(
  options: Parameters<Awaited<ReturnType<typeof loadPiProjectTrust>>['resolveProjectTrusted']>[0],
): Promise<boolean> {
  const mod = await loadPiProjectTrust();
  return mod.resolveProjectTrusted(options);
}
