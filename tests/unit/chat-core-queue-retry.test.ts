import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostRequest } from '@shared/host-api/types';
import type { PiRuntimeStateResult } from '@shared/host-api/contract';
import { createChatStore, type ChatStore, type HostEventSubscriber } from '@/stores/chat';

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

function bindActiveSession(store: ChatStore, sessionId = 'session-1', generation = 1) {
  store.setState({
    started: true,
    cwd: '/tmp/test-ws',
    sessionId,
    boundSessionId: sessionId,
    boundSessionPath: `/tmp/${sessionId}.jsonl`,
    generation,
    running: true,
    isStreaming: true,
  });
}

let uninstallBridge: (() => void) | undefined;
afterEach(() => {
  uninstallBridge?.();
  uninstallBridge = undefined;
});

describe('chat-core queue and retry lifecycle', () => {
  it('run.started 不会清空已有的 queue 排队消息', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    bindActiveSession(store, 'session-1', 1);

    // 模拟收到 queue.updated 事件，排入 followUp 消息
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'queue.updated', steering: [], followUp: ['queued follow-up message'] },
    });

    expect(store.getState().queue.followUp).toEqual(['queued follow-up message']);

    // 模拟重试或新回合触发 run.started
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.started' },
    });

    // 验证：queue 不应被盲目重置为 []
    expect(store.getState().queue.followUp).toEqual(['queued follow-up message']);
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().running).toBe(true);
  });

  it('run.ended 在 willRetry: true 时保持 running: true，等待下次重试', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    bindActiveSession(store, 'session-1', 1);

    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended', willRetry: true },
    });

    // willRetry 时流式暂停等待重试倒计时，但会话整体仍处于 running 状态
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().running).toBe(true);
    expect(store.getState().retry).toBeNull();
  });

  it('在完整重试周期内排队消息持续保留，直到 Pi 消费并更新 queue', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    bindActiveSession(store, 'session-1', 1);

    // 1. 首次请求失败，Pi 报告 willRetry: true
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended', willRetry: true },
    });

    // 2. Pi 触发 auto_retry_start (retry.started)
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'retry.started', attempt: 1, maxAttempts: 3, delayMs: 2000, message: 'Network error' },
    });
    expect(store.getState().retry?.attempt).toBe(1);

    // 3. 用户在倒计时中发送一条 follow-up 消息，收到 queue.updated
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'queue.updated', steering: [], followUp: ['user pending message'] },
    });
    expect(store.getState().queue.followUp).toEqual(['user pending message']);

    // 4. 2秒倒计时结束，Pi 执行 agent.continue() 触发 run.started (Attempt 2)
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.started' },
    });
    // 关键校验：排队消息不能消失！
    expect(store.getState().queue.followUp).toEqual(['user pending message']);

    // 5. Attempt 2 再次失败，进入 Attempt 3 倒计时
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended', willRetry: true },
    });
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'retry.started', attempt: 2, maxAttempts: 3, delayMs: 4000, message: 'Network error' },
    });
    expect(store.getState().queue.followUp).toEqual(['user pending message']);

    // 6. Attempt 3 开始
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.started' },
    });
    expect(store.getState().queue.followUp).toEqual(['user pending message']);

    // 7. 重试结束，Pi 消费排队消息并发出 queue.updated 清空
    bus.emit('piRuntime.event', {
      sessionId: 'session-1',
      generation: 1,
      at: Date.now(),
      event: { type: 'queue.updated', steering: [], followUp: [] },
    });
    expect(store.getState().queue.followUp).toEqual([]);
  });

  it('sessionReplaced 应用 state.queue 快照', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });

    const snapshot: PiRuntimeStateResult = {
      sessionId: 'session-2',
      cwd: '/tmp/ws',
      generation: 1,
      thinkingLevel: 'off',
      availableThinkingLevels: [],
      isStreaming: false,
      messages: [],
      messageEntryIds: [],
      queue: {
        steering: ['urgent steering'],
        followUp: ['next follow-up'],
      },
    };

    bus.emit('piRuntime.sessionReplaced', snapshot);

    expect(store.getState().queue).toEqual({
      steering: ['urgent steering'],
      followUp: ['next follow-up'],
    });
  });
});
