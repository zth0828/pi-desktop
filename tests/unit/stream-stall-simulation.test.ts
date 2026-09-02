import { describe, expect, it, vi, afterEach } from 'vitest';
import type { HostRequest } from '@shared/host-api/types';
import { createChatStore, type ChatStore, type HostEventSubscriber } from '@/stores/chat';
import type { PiDesktopMessage } from '@shared/pi-event-map';

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

function bindActiveSession(store: ChatStore) {
  store.setState({
    started: true,
    cwd: '/tmp/workspace',
    sessionId: 'session-sim',
    boundSessionId: 'session-sim',
    boundSessionPath: '/tmp/workspace/session.jsonl',
    generation: 1,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Hello, help me code.' }], streaming: false, raw: {} },
    ],
  });
}

let uninstallBridge: (() => void) | undefined;
afterEach(() => {
  uninstallBridge?.();
  uninstallBridge = undefined;
});

describe('流式停滞与错误恢复模拟走查', () => {
  it('模拟场景 1：发消息遇到 401 鉴权失败，首包仅有 errorMessage 且 content 为空', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    bindActiveSession(store);

    // 1. 发送消息，模拟 run.started 到达
    bus.emit('piRuntime.event', {
      sessionId: 'session-sim',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.started' },
    });
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().running).toBe(true);

    // 2. 模拟底层请求 401 失败，pi 推送 message.ended（带 errorMessage，content 为空）
    const failedMessage: PiDesktopMessage = {
      role: 'assistant',
      content: [],
      errorMessage: 'Authentication failed (401): invalid api key',
      stopReason: 'error',
    };
    bus.emit('piRuntime.event', {
      sessionId: 'session-sim',
      generation: 1,
      at: Date.now(),
      event: { type: 'message.ended', message: failedMessage },
    });

    // 3. 模拟 run.ended 到达
    bus.emit('piRuntime.event', {
      sessionId: 'session-sim',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended', willRetry: false },
    });

    // 断言：前台状态已经彻底脱离流式与转圈
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().running).toBe(false);

    // 断言：错误消息已被正确保存到 messages 列表中供渲染
    const messages = store.getState().messages;
    expect(messages.length).toBe(2);
    const lastAssistant = messages[1];
    expect(lastAssistant.role).toBe('assistant');
    expect((lastAssistant.raw as { errorMessage?: string })?.errorMessage).toBe('Authentication failed (401): invalid api key');
  });

  it('模拟场景 2：发消息遇到网络断开 / 代理不可达，prompt IPC 抛出异常', async () => {
    uninstallBridge = installBridge((request) => {
      if (request.action === 'prompt') {
        throw new Error('connect ECONNREFUSED 127.0.0.1:54321');
      }
      return { success: true };
    });

    const store = createChatStore();
    bindActiveSession(store);
    // 假设界面之前处在某些挂起态
    store.setState({ isStreaming: true, running: true });

    await store.getState().prompt('test network fail');

    // 断言：prompt 捕获异常后，前台 isStreaming 和 running 立即被复位为 false
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().running).toBe(false);
    expect(store.getState().runtimeError).toBe('connect ECONNREFUSED 127.0.0.1:54321');
  });

  it('模拟场景 3：流式事件丢失情况下，Main 广播 runtimeStateChanged 权威纠正前台', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    bindActiveSession(store);

    // 假设因网络或意外导致 run.ended 丢失，前台依然处于 isStreaming: true
    store.setState({ isStreaming: true, running: true });

    // Main 进程在后台检测到 session 结束，推送 runtimeStateChanged
    bus.emit('piRuntime.runtimeStateChanged', {
      sessionId: 'session-sim',
      sessionPath: '/tmp/workspace/session.jsonl',
      running: false,
    });

    // 断言：前台收到 running: false 时，isStreaming 被强制对齐复位，杜绝死锁转圈
    expect(store.getState().running).toBe(false);
    expect(store.getState().isStreaming).toBe(false);
  });
});
