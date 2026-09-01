// expectingReplacement 相关性匹配与超时兜底（面板劫持竞态）：
// 同窗口两面板并发 newSession/fork 时，sessionReplaced 只被发起面板应用；
// 事件丢失时等待标志在时限内收敛并写入 runtimeError 哨兵。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiRuntimeStateResult } from '@shared/host-api/contract';
import type { HostRequest } from '@shared/host-api/types';
import { createChatStore, type ChatStore, type HostEventSubscriber } from '@/stores/chat';
import { SESSION_REPLACEMENT_TIMEOUT } from '@/lib/session-binding';

/** mock window.pidesktop.hostInvoke：按 action 分发；responder 抛错 → ok:false 响应 */
function installBridge(responder: (request: HostRequest) => unknown): () => void {
  (globalThis as { window?: unknown }).window = {
    pidesktop: {
      hostInvoke: vi.fn(async (request: HostRequest) => {
        try {
          return { id: request.id, ok: true, data: responder(request) };
        } catch (err) {
          return {
            id: request.id,
            ok: false,
            error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
          };
        }
      }),
    },
  };
  return () => {
    delete (globalThis as { window?: unknown }).window;
  };
}

/** 伪 host 事件总线：与 chat-store-instance.test.ts 同款，测试手动派发 */
function createFakeBus() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const onEvent: HostEventSubscriber = (module, event, handler) => {
    const key = `${module}.${String(event)}`;
    const list = handlers.get(key) ?? [];
    list.push(handler as (...args: unknown[]) => void);
    handlers.set(key, list);
    return () => {
      handlers.set(key, (handlers.get(key) ?? []).filter((h) => h !== handler));
    };
  };
  const emit = (key: string, payload: unknown) => {
    for (const handler of handlers.get(key) ?? []) handler(payload);
  };
  return { onEvent, emit };
}

function stateSnapshot(
  sessionId: string,
  sessionFile: string,
  replacementActionId?: string,
): PiRuntimeStateResult {
  return {
    sessionId,
    cwd: '/tmp/ws',
    generation: 2,
    thinkingLevel: 'off',
    availableThinkingLevels: [],
    isStreaming: false,
    messages: [],
    messageEntryIds: [],
    sessionFile,
    ...(replacementActionId !== undefined ? { replacementActionId } : {}),
  };
}

function bindSession(store: ChatStore, sessionId: string, sessionFile: string) {
  store.setState({
    started: true,
    cwd: '/tmp/ws',
    sessionId,
    boundSessionId: sessionId,
    boundSessionPath: sessionFile,
    generation: 1,
  });
}

let uninstallBridge: (() => void) | undefined;
afterEach(() => {
  vi.useRealTimers();
  uninstallBridge?.();
  uninstallBridge = undefined;
});

describe('两面板并发替换的相关性匹配', () => {
  it('两实例同时 expecting：A 发起的替换广播只被 A 应用，B 不被劫持', async () => {
    const bus = createFakeBus();
    const newSessionPayloads: Array<{ actionId?: string }> = [];
    uninstallBridge = installBridge((request) => {
      if (request.action === 'newSession') {
        newSessionPayloads.push(request.payload as { actionId?: string });
      }
      return { success: true };
    });
    const a = createChatStore({ onEvent: bus.onEvent });
    const b = createChatStore({ onEvent: bus.onEvent });
    bindSession(a, 's-a', '/tmp/a.jsonl');
    bindSession(b, 's-b', '/tmp/b.jsonl');

    // 两面板同时各自发起 newSession（invoke 返回前都处于 expecting）
    const pendingA = a.getState().newSession();
    const pendingB = b.getState().newSession();
    expect(a.getState().expectingReplacement).toBe(true);
    expect(b.getState().expectingReplacement).toBe(true);
    expect(newSessionPayloads).toHaveLength(2);
    const actionA = newSessionPayloads[0]?.actionId;
    const actionB = newSessionPayloads[1]?.actionId;
    expect(actionA).toBeTruthy();
    expect(actionB).toBeTruthy();
    expect(actionA).not.toBe(actionB);

    // A 发起的替换事件先到达（同窗口两面板都收到）
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-a-new', '/tmp/a-new.jsonl', actionA));
    expect(a.getState().boundSessionId).toBe('s-a-new');
    expect(a.getState().expectingReplacement).toBe(false);
    // B 不被劫持：仍绑定自己的会话并等待自己的替换
    expect(b.getState().boundSessionId).toBe('s-b');
    expect(b.getState().expectingReplacement).toBe(true);

    // B 的替换事件随后到达，只被 B 应用
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-b-new', '/tmp/b-new.jsonl', actionB));
    expect(b.getState().boundSessionId).toBe('s-b-new');
    expect(b.getState().expectingReplacement).toBe(false);
    expect(a.getState().boundSessionId).toBe('s-a-new');

    await Promise.all([pendingA, pendingB]);
    a.dispose();
    b.dispose();
  });

  it('forkFrom 同样携带动作 id：不匹配的事件不应用，匹配的应用并改绑', async () => {
    const bus = createFakeBus();
    let forkActionId: string | undefined;
    uninstallBridge = installBridge((request) => {
      if (request.action === 'fork') {
        forkActionId = (request.payload as { actionId?: string }).actionId;
      }
      return { success: true, selectedText: 'forked text' };
    });
    const store = createChatStore({ onEvent: bus.onEvent });
    bindSession(store, 's1', '/tmp/s1.jsonl');

    await store.getState().forkFrom('e1');
    expect(forkActionId).toBeTruthy();
    expect(store.getState().expectingReplacement).toBe(true);

    // 其他面板发起的替换（动作 id 不匹配）不应用
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-other', '/tmp/other.jsonl', 'replacement-999'));
    expect(store.getState().boundSessionId).toBe('s1');
    expect(store.getState().expectingReplacement).toBe(true);

    // 自己的 fork 结果到达才应用
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-forked', '/tmp/forked.jsonl', forkActionId));
    expect(store.getState().boundSessionId).toBe('s-forked');
    expect(store.getState().expectingReplacement).toBe(false);
    store.dispose();
  });

  it('switch 兜底等待不被带动作 id 的替换事件劫持，仍等无 id 的广播', async () => {
    const bus = createFakeBus();
    uninstallBridge = installBridge((request) => {
      if (request.action === 'switch') return { success: true };
      if (request.action === 'getState') throw new Error('state unavailable');
      return { success: true };
    });
    const store = createChatStore({ onEvent: bus.onEvent });

    const result = await store.getState().switchSession('/tmp/attach.jsonl', '/tmp/ws');
    expect(result.success).toBe(true);
    expect(store.getState().expectingReplacement).toBe(true);

    // 其他面板 newSession 的替换事件（带动作 id）不消费本面板的兜底等待
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-other-new', '/tmp/other.jsonl', 'replacement-9'));
    expect(store.getState().boundSessionId).toBeNull();

    // switch 链路的广播（不带动作 id）照常兜底
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-attached', '/tmp/attach.jsonl'));
    expect(store.getState().boundSessionId).toBe('s-attached');
    expect(store.getState().started).toBe(true);
    store.dispose();
  });
});

describe('expectingReplacement 超时兜底', () => {
  it('替换事件丢失：超时后清除等待标志并写 runtimeError 哨兵', async () => {
    vi.useFakeTimers();
    uninstallBridge = installBridge(() => ({ success: true }));
    const store = createChatStore();
    bindSession(store, 's1', '/tmp/s1.jsonl');

    await store.getState().newSession();
    expect(store.getState().expectingReplacement).toBe(true);

    vi.advanceTimersByTime(30_000);
    const s = store.getState();
    expect(s.expectingReplacement).toBe(false);
    expect(s.expectedReplacementActionId).toBeNull();
    expect(s.runtimeError).toBe(SESSION_REPLACEMENT_TIMEOUT);
    store.dispose();
  });

  it('事件按动作 id 应用后清理定时器：超时不再误报', async () => {
    vi.useFakeTimers();
    const bus = createFakeBus();
    let actionId: string | undefined;
    uninstallBridge = installBridge((request) => {
      if (request.action === 'newSession') {
        actionId = (request.payload as { actionId?: string }).actionId;
      }
      return { success: true };
    });
    const store = createChatStore({ onEvent: bus.onEvent });
    bindSession(store, 's1', '/tmp/s1.jsonl');

    await store.getState().newSession();
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s-new', '/tmp/new.jsonl', actionId));
    expect(store.getState().boundSessionId).toBe('s-new');

    vi.advanceTimersByTime(30_000);
    expect(store.getState().runtimeError).toBeUndefined();
    expect(store.getState().expectingReplacement).toBe(false);
    store.dispose();
  });

  it('dispose 清理等待定时器：面板卸载后超时不再写状态', async () => {
    vi.useFakeTimers();
    uninstallBridge = installBridge(() => ({ success: true }));
    const store = createChatStore();
    bindSession(store, 's1', '/tmp/s1.jsonl');

    await store.getState().newSession();
    store.dispose();

    vi.advanceTimersByTime(30_000);
    expect(store.getState().runtimeError).toBeUndefined();
    expect(store.getState().expectingReplacement).toBe(true);
  });

  it('再次发起替换时重置等待：旧定时器不残留', async () => {
    vi.useFakeTimers();
    uninstallBridge = installBridge(() => ({ success: true }));
    const store = createChatStore();
    bindSession(store, 's1', '/tmp/s1.jsonl');

    await store.getState().newSession();
    const firstActionId = store.getState().expectedReplacementActionId;
    // 第一次的事件丢失，用户重试
    await store.getState().newSession();
    const secondActionId = store.getState().expectedReplacementActionId;
    expect(secondActionId).toBeTruthy();
    expect(secondActionId).not.toBe(firstActionId);

    // 只有当前等待的定时器存活：30s 后超时收敛的是第二次等待
    vi.advanceTimersByTime(30_000);
    expect(store.getState().runtimeError).toBe(SESSION_REPLACEMENT_TIMEOUT);
    expect(store.getState().expectedReplacementActionId).toBeNull();
    store.dispose();
  });

  it('newSession 失败撤销等待并清动作 id', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'newSession') return { success: false, error: 'cannot create' };
      return { success: true };
    });
    const store = createChatStore();
    bindSession(store, 's1', '/tmp/s1.jsonl');

    await store.getState().newSession();
    const s = store.getState();
    expect(s.expectingReplacement).toBe(false);
    expect(s.expectedReplacementActionId).toBeNull();
    expect(s.runtimeError).toBe('cannot create');
    store.dispose();
  });
});
