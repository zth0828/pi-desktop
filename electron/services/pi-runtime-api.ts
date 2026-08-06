// pi 会话运行时：壳与 pi SDK 的唯一接触面之一（会话生命周期 + 事件桥）。
// 事件映射在 shared/pi-event-map.ts（单点）。会话替换（new/switch/fork）后
// 必须重新 subscribe + bindExtensions（SDK 约定，见 docs/sdk.md）。
import {
  mapPiSessionEvent,
  type PiRuntimeEventEnvelope,
} from '@shared/pi-event-map';
import type {
  PiRuntimePromptPayload,
  PiRuntimeStartPayload,
  PiRuntimeStateResult,
} from '@shared/host-api/contract';
import type { AgentSession, AgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import { sendHostEvent } from '../main/ipc/host-events';
import { loadPiSdk, type PiSdk } from '../utils/pi-loader';

export type ActiveRuntime = {
  sdk: PiSdk;
  runtime: AgentSessionRuntime;
  cwd: string;
  sessionId: string;
  generation: number;
  unsubscribe: () => void;
};

let active: ActiveRuntime | null = null;
let startInFlight: Promise<PiRuntimeStateResult> | null = null;

/** 当前活动运行时（供 piSessions 等兄弟服务复用；只读使用，替换会话须走 afterSessionReplaced）。 */
export function getActiveRuntime(): ActiveRuntime | null {
  return active;
}

function snapshotState(runtime: ActiveRuntime): PiRuntimeStateResult {
  const session = runtime.runtime.session;
  return {
    sessionId: session.sessionId,
    cwd: runtime.cwd,
    generation: runtime.generation,
    model: session.model
      ? { provider: session.model.provider, id: session.model.id, name: session.model.name }
      : undefined,
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    messages: session.messages as unknown[],
    sessionFile: session.sessionFile,
  };
}

function bridgeSessionEvents(runtime: ActiveRuntime): void {
  const session = runtime.runtime.session;
  runtime.unsubscribe = session.subscribe((piEvent) => {
    const mapped = mapPiSessionEvent(piEvent);
    if (!mapped) return;
    const envelope: PiRuntimeEventEnvelope = {
      sessionId: runtime.sessionId,
      generation: runtime.generation,
      at: Date.now(),
      event: mapped,
    };
    sendHostEvent('piRuntime', 'event', envelope);
  });
}

async function bindCurrentSession(runtime: ActiveRuntime): Promise<void> {
  const session = runtime.runtime.session;
  // Spike B 结论：不调 bindExtensions 扩展收不到 session_start（MCP 等全部失效）。
  // mode 用 'print'（无 TUI，与 pi 自己的 headless 模式一致）。
  await session.bindExtensions({
    mode: 'print',
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      newSession: async (options) => {
        const result = await runtime.runtime.newSession(options);
        return { cancelled: result.cancelled };
      },
      fork: async (entryId, options) => {
        const result = await runtime.runtime.fork(entryId, options);
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId, options) => {
        const result = await session.navigateTree(targetId, options);
        return { cancelled: result.cancelled, editorText: result.editorText };
      },
      switchSession: async (sessionPath, options) =>
        runtime.runtime.switchSession(sessionPath, options),
      reload: async () => {
        await session.reload();
      },
    },
    onError: (error) => {
      const err = error as { error?: unknown };
      const message =
        err.error instanceof Error ? err.error.message : String(err.error ?? 'unknown');
      sendHostEvent('piRuntime', 'event', {
        sessionId: runtime.sessionId,
        generation: runtime.generation,
        at: Date.now(),
        event: { type: 'retry.started', message: `extension error: ${message}` },
      } satisfies PiRuntimeEventEnvelope);
    },
  });
}

async function createRuntime(cwd: string): Promise<ActiveRuntime> {
  const sdk = await loadPiSdk();
  const agentDir = sdk.getAgentDir();
  const createFactory = async ({
    cwd: effectiveCwd,
    sessionManager,
    sessionStartEvent,
  }: {
    cwd: string;
    sessionManager: unknown;
    sessionStartEvent?: unknown;
  }) => {
    const services = await sdk.createAgentSessionServices({ cwd: effectiveCwd, agentDir });
    return {
      ...(await sdk.createAgentSessionFromServices({
        services,
        sessionManager: sessionManager as never,
        sessionStartEvent: sessionStartEvent as never,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  const runtime = await sdk.createAgentSessionRuntime(createFactory as never, {
    cwd,
    agentDir,
    sessionManager: sdk.SessionManager.create(cwd),
  });
  const active_: ActiveRuntime = {
    sdk,
    runtime,
    cwd,
    sessionId: runtime.session.sessionId,
    generation: 1,
    unsubscribe: () => {},
  };
  await bindCurrentSession(active_);
  bridgeSessionEvents(active_);
  return active_;
}

/** 会话替换（new/switch/fork）后的统一收尾：重绑 + 重订阅 + 通知渲染层清空。 */
export async function afterSessionReplaced(runtime: ActiveRuntime): Promise<PiRuntimeStateResult> {
  runtime.unsubscribe();
  runtime.generation += 1;
  runtime.sessionId = runtime.runtime.session.sessionId;
  await bindCurrentSession(runtime);
  bridgeSessionEvents(runtime);
  const state = snapshotState(runtime);
  sendHostEvent('piRuntime', 'sessionReplaced', state);
  return state;
}

export const piRuntimeApi = {
  start: async (payload: PiRuntimeStartPayload): Promise<PiRuntimeStateResult> => {
    if (active && active.cwd === payload.cwd) return snapshotState(active);
    if (startInFlight) await startInFlight.catch(() => {});
    if (active && active.cwd !== payload.cwd) {
      active.unsubscribe();
      active.runtime.dispose();
      active = null;
    }
    startInFlight = (async () => {
      active = await createRuntime(payload.cwd);
      return snapshotState(active);
    })();
    try {
      return await startInFlight;
    } finally {
      startInFlight = null;
    }
  },

  getState: (): PiRuntimeStateResult | null => (active ? snapshotState(active) : null),

  prompt: async (payload: PiRuntimePromptPayload) => {
    if (!active) return { success: false, error: 'session not started' };
    const session = active.runtime.session;
    try {
      await session.prompt(payload.text, {
        images: payload.images as never,
        // 生成中提交 = steer（docs §4.1：输入框在生成中仍可提交，自动 steer）
        ...(session.isStreaming ? { streamingBehavior: 'steer' as const } : {}),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  abort: async () => {
    if (!active) return { success: false, error: 'session not started' };
    await active.runtime.session.abort();
    return { success: true };
  },

  newSession: async () => {
    if (!active) return { success: false, error: 'session not started' };
    await active.runtime.newSession();
    await afterSessionReplaced(active);
    return { success: true };
  },

  compact: async () => {
    if (!active) return { success: false, error: 'session not started' };
    try {
      await active.runtime.session.compact();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  setThinkingLevel: async (payload: { level: string }) => {
    if (!active) return { success: false, error: 'session not started' };
    active.runtime.session.setThinkingLevel(payload.level as never);
    return { success: true };
  },

  setModel: async (payload: { provider: string; id: string }) => {
    if (!active) return { success: false, error: 'session not started' };
    const model = active.runtime.services.modelRuntime.getModel(payload.provider, payload.id);
    if (!model) return { success: false, error: `model not found: ${payload.provider}/${payload.id}` };
    await active.runtime.session.setModel(model);
    return { success: true };
  },

  /** / 补全数据源：内置命令 + prompt 模板 + skills（docs §4.3）。 */
  getCommands: () => {
    if (!active) return { commands: [] };
    const loader = active.runtime.services.resourceLoader;
    const prompts = loader.getPrompts().prompts.map((p) => ({
      name: p.name,
      description: p.description,
      source: `prompt:${(p.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
    }));
    const skills = loader.getSkills().skills.map((s) => ({
      name: `skill:${s.name}`,
      description: s.description,
      source: `skill:${(s.sourceInfo as { label?: string } | undefined)?.label ?? ''}`,
    }));
    const builtIns = [
      { name: 'new', description: 'New session', source: 'built-in' },
      { name: 'compact', description: 'Compact context', source: 'built-in' },
    ];
    return { commands: [...builtIns, ...prompts, ...skills] };
  },
};
