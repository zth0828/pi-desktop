// chat-core 错误状态机：switchSession 失败记录（重试语义）、运行期错误分流
// （runtimeError 与 startError 各归其位）、attach 兜底路径 sessionReplaced 置 started。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiRuntimeStateResult } from '@shared/host-api/contract';
import type { HostRequest } from '@shared/host-api/types';
import { createChatStore, type ChatStore, type HostEventSubscriber } from '@/stores/chat';

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

/** mock hostInvoke：所有请求固定失败（携带 main 侧 HostError 的 code/message 形状） */
function installCodedBridge(error: { code: string; message: string }): () => void {
  (globalThis as { window?: unknown }).window = {
    pidesktop: {
      hostInvoke: vi.fn(async (request: HostRequest) => ({
        id: request.id,
        ok: false,
        error,
      })),
    },
  };
  return () => {
    delete (globalThis as { window?: unknown }).window;
  };
}

/** 伪 host 事件总线（与 chat-store-instance.test.ts 同款）：测试手动派发 */
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

function stateSnapshot(sessionId: string, sessionFile: string): PiRuntimeStateResult {
  return {
    sessionId,
    cwd: '/tmp/ws',
    generation: 2,
    thinkingLevel: 'off',
    availableThinkingLevels: [],
    isStreaming: false,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
    messageEntryIds: ['e1'],
    sessionFile,
  };
}

/** 面板已绑定旧会话（started）的初始态：切换失败后旧会话应仍可用、消息仍展示 */
function bindOldSession(store: ChatStore) {
  store.setState({
    started: true,
    cwd: '/tmp/ws',
    sessionId: 'old',
    boundSessionId: 'old',
    boundSessionPath: '/tmp/old.jsonl',
    generation: 1,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'old question' }], streaming: false, raw: {} },
    ],
  });
}

let uninstallBridge: (() => void) | undefined;
afterEach(() => {
  uninstallBridge?.();
  uninstallBridge = undefined;
});

describe('switchSession 失败记录与重试语义', () => {
  it('失败时记录 lastFailedSwitch，保留 started 与旧会话 messages', async () => {
    uninstallBridge = installBridge(() => ({ success: false, error: 'model not found: x/y' }));
    const store = createChatStore();
    bindOldSession(store);

    const result = await store.getState().switchSession('/tmp/new.jsonl', '/tmp/ws2');

    expect(result).toEqual({ success: false, error: 'model not found: x/y' });
    const s = store.getState();
    expect(s.startError).toBe('model not found: x/y');
    expect(s.lastFailedSwitch).toEqual({ path: '/tmp/new.jsonl', cwd: '/tmp/ws2' });
    expect(s.started).toBe(true);
    expect(s.starting).toBe(false);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]?.content[0]?.text).toBe('old question');
  });

  it('IPC 抛错同样记录 lastFailedSwitch', async () => {
    uninstallBridge = installBridge(() => {
      throw new Error('bridge exploded');
    });
    const store = createChatStore();
    bindOldSession(store);

    const result = await store.getState().switchSession('/tmp/new.jsonl');

    expect(result.success).toBe(false);
    expect(store.getState().lastFailedSwitch).toEqual({ path: '/tmp/new.jsonl' });
    expect(store.getState().startError).toBe('bridge exploded');
    expect(store.getState().started).toBe(true);
  });

  it('切换成功（getState 可用）清除 lastFailedSwitch 并改绑新会话', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'switch') return { success: true };
      if (request.action === 'getState') return stateSnapshot('new', '/tmp/new.jsonl');
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);
    store.setState({ lastFailedSwitch: { path: '/tmp/other.jsonl', cwd: '/tmp/ws' } });

    const result = await store.getState().switchSession('/tmp/new.jsonl', '/tmp/ws');

    expect(result.success).toBe(true);
    const s = store.getState();
    expect(s.lastFailedSwitch).toBeNull();
    expect(s.startError).toBeUndefined();
    expect(s.started).toBe(true);
    expect(s.starting).toBe(false);
    expect(s.boundSessionId).toBe('new');
    expect(s.boundSessionPath).toBe('/tmp/new.jsonl');
  });

  it('start() 清除历史 lastFailedSwitch（重试按钮此后按 start 语义工作）', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'start') return stateSnapshot('fresh', '/tmp/fresh.jsonl');
      return { success: true };
    });
    const store = createChatStore();
    store.setState({
      lastFailedSwitch: { path: '/tmp/old-target.jsonl', cwd: '/tmp/ws' },
      startError: 'old error',
    });

    await store.getState().start('/tmp/ws');

    expect(store.getState().lastFailedSwitch).toBeNull();
    expect(store.getState().startError).toBeUndefined();
    expect(store.getState().started).toBe(true);
  });
});

describe('start/switchSession 失败错误码记录（MODEL_UNAVAILABLE 自救入口）', () => {
  it('switchSession IPC 失败携带 code 时记录 startErrorCode 与 lastFailedSwitch', async () => {
    uninstallBridge = installCodedBridge({ code: 'MODEL_UNAVAILABLE', message: 'model not found: x/y' });
    const store = createChatStore();
    bindOldSession(store);

    const result = await store.getState().switchSession('/tmp/new.jsonl', '/tmp/ws2');

    expect(result).toEqual({ success: false, error: 'model not found: x/y' });
    const s = store.getState();
    expect(s.startError).toBe('model not found: x/y');
    expect(s.startErrorCode).toBe('MODEL_UNAVAILABLE');
    expect(s.lastFailedSwitch).toEqual({ path: '/tmp/new.jsonl', cwd: '/tmp/ws2' });
  });

  it('result 型失败（success:false 返回）不携带错误码', async () => {
    uninstallBridge = installBridge(() => ({ success: false, error: 'cancelled' }));
    const store = createChatStore();
    bindOldSession(store);

    await store.getState().switchSession('/tmp/new.jsonl');

    expect(store.getState().startError).toBe('cancelled');
    expect(store.getState().startErrorCode).toBeUndefined();
  });

  it('start IPC 失败记录 startErrorCode，成功后清除', async () => {
    uninstallBridge = installCodedBridge({ code: 'MODEL_UNAVAILABLE', message: 'model not found: x/y' });
    const store = createChatStore();

    await store.getState().start('/tmp/ws');

    expect(store.getState().startError).toBe('model not found: x/y');
    expect(store.getState().startErrorCode).toBe('MODEL_UNAVAILABLE');
    expect(store.getState().started).toBe(false);

    uninstallBridge = installBridge((request) => {
      if (request.action === 'start') return stateSnapshot('fresh', '/tmp/fresh.jsonl');
      return { success: true };
    });
    await store.getState().start('/tmp/ws');

    expect(store.getState().startError).toBeUndefined();
    expect(store.getState().startErrorCode).toBeUndefined();
    expect(store.getState().started).toBe(true);
  });
});

describe('attach 兜底路径 sessionReplaced 置 started', () => {
  it('switch 成功但 getState 失败后，sessionReplaced 事件把面板置为已启动', async () => {
    const bus = createFakeBus();
    uninstallBridge = installBridge((request) => {
      if (request.action === 'switch') return { success: true };
      if (request.action === 'getState') throw new Error('state unavailable');
      return { success: true };
    });
    const store = createChatStore({ onEvent: bus.onEvent });

    // 新面板 attach：此前从未绑定会话，started 本来就是 false
    expect(store.getState().started).toBe(false);
    const result = await store.getState().switchSession('/tmp/attach.jsonl', '/tmp/ws');
    expect(result.success).toBe(true);
    expect(store.getState().expectingReplacement).toBe(true);
    expect(store.getState().started).toBe(false);

    bus.emit('piRuntime.sessionReplaced', stateSnapshot('attached', '/tmp/attach.jsonl'));

    const s = store.getState();
    expect(s.started).toBe(true);
    expect(s.boundSessionId).toBe('attached');
    expect(s.expectingReplacement).toBe(false);
    expect(s.lastFailedSwitch).toBeNull();
  });
});

describe('运行期错误分流（runtimeError 与 startError）', () => {
  it('prompt 失败写 runtimeError，不写 startError', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'prompt') return { success: false, error: 'session not started' };
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);

    await store.getState().prompt('hello');

    expect(store.getState().runtimeError).toBe('session not started');
    expect(store.getState().startError).toBeUndefined();
  });

  it('runBash 失败写 runtimeError 并清理 bashDraft', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'executeBash') return { success: false, error: 'bash failed' };
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);

    await store.getState().runBash('ls', true);

    expect(store.getState().runtimeError).toBe('bash failed');
    expect(store.getState().bashDraft).toBeNull();
    expect(store.getState().startError).toBeUndefined();
  });

  it('queueRemove / queueMove 失败写 runtimeError', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'queueRemove') return { success: false, error: 'remove failed' };
      if (request.action === 'queueMove') return { success: false, error: 'move failed' };
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);

    await store.getState().queueRemove('steering', 0);
    await store.getState().queueMove('steering', 0, 'followUp');

    expect(store.getState().runtimeError).toBe('move failed');
    expect(store.getState().startError).toBeUndefined();
  });

  it('newSession 失败写 runtimeError 并撤销 expectingReplacement', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'newSession') return { success: false, error: 'cannot create' };
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);

    await store.getState().newSession();

    expect(store.getState().runtimeError).toBe('cannot create');
    expect(store.getState().expectingReplacement).toBe(false);
    expect(store.getState().startError).toBeUndefined();
  });

  it('forkFrom 失败写 runtimeError 并撤销 expectingReplacement', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'fork') return { success: false, error: 'fork failed' };
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);

    await store.getState().forkFrom('e1');

    expect(store.getState().runtimeError).toBe('fork failed');
    expect(store.getState().expectingReplacement).toBe(false);
    expect(store.getState().startError).toBeUndefined();
  });

  it('editMessage 流式中 abort 失败写 runtimeError 并清挂起编辑', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'abort') throw new Error('abort failed');
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);
    store.setState({ isStreaming: true, running: true });

    await store.getState().editMessage('e1');

    expect(store.getState().runtimeError).toBe('abort failed');
    expect(store.getState().pendingEditEntryId).toBeNull();
    expect(store.getState().startError).toBeUndefined();
  });

  it('navigateTo 失败写 runtimeError；aborted 不写', async () => {
    let respondAborted = false;
    uninstallBridge = installBridge((request) => {
      if (request.action === 'navigateTree') {
        return respondAborted
          ? { success: false, aborted: true, error: 'aborted' }
          : { success: false, error: 'navigate failed' };
      }
      return { success: true };
    });
    const store = createChatStore();
    bindOldSession(store);

    const failed = await store.getState().navigateTo('t1');
    expect(failed.success).toBe(false);
    expect(store.getState().runtimeError).toBe('navigate failed');

    respondAborted = true;
    store.getState().dismissRuntimeError();
    const aborted = await store.getState().navigateTo('t2');
    expect(aborted.success).toBe(false);
    expect(store.getState().runtimeError).toBeUndefined();
    expect(store.getState().startError).toBeUndefined();
  });

  it('dismissRuntimeError 关闭提示；applyState 清空过期 runtimeError', () => {
    const store = createChatStore();
    store.setState({ runtimeError: 'transient failure' });

    store.getState().dismissRuntimeError();
    expect(store.getState().runtimeError).toBeUndefined();

    store.setState({ runtimeError: 'another failure' });
    store.getState().applyState(stateSnapshot('next', '/tmp/next.jsonl'));
    expect(store.getState().runtimeError).toBeUndefined();
  });
});
