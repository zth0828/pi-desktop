// 多面板 P2：chat store 实例隔离——两个 createChatStore() 实例绑定不同会话，
// 共享同一 host 事件总线时，事件只进匹配实例；dispose 后实例退订。
import { describe, expect, it, vi } from 'vitest';
import type { PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import type { PiRuntimeStateResult, PiUiRequestPayload } from '@shared/host-api/contract';
import type { HostRequest } from '@shared/host-api/types';
import { createChatStore, type HostEventSubscriber } from '@/stores/chat';

/** 伪 host 事件总线：与 onHostEvent 同签名，测试手动派发 */
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

function envelope(sessionId: string, generation: number, type: string): PiRuntimeEventEnvelope {
  return { sessionId, generation, at: Date.now(), event: { type } as PiRuntimeEventEnvelope['event'] };
}

function stateSnapshot(sessionId: string, generation: number): PiRuntimeStateResult {
  return {
    sessionId,
    cwd: '/tmp/ws',
    generation,
    thinkingLevel: 'off',
    availableThinkingLevels: [],
    isStreaming: false,
    messages: [],
    messageEntryIds: [],
    sessionFile: `/tmp/${sessionId}.jsonl`,
  };
}

function uiRequest(sessionId: string, generation: number, requestId: string): PiUiRequestPayload {
  return { requestId, sessionId, generation, kind: 'confirm', title: `req-${requestId}` };
}

describe('chat store 实例隔离（多面板 P2）', () => {
  it('流式事件只进 boundSessionId 匹配的实例', () => {
    const bus = createFakeBus();
    const a = createChatStore({ onEvent: bus.onEvent });
    const b = createChatStore({ onEvent: bus.onEvent });
    a.setState({ boundSessionId: 's1', generation: 1 });
    b.setState({ boundSessionId: 's2', generation: 1 });

    bus.emit('piRuntime.event', envelope('s1', 1, 'run.started'));
    expect(a.getState().isStreaming).toBe(true);
    expect(b.getState().isStreaming).toBe(false);

    bus.emit('piRuntime.event', envelope('s2', 1, 'run.started'));
    expect(b.getState().isStreaming).toBe(true);
  });

  it('generation 不匹配的事件被丢弃', () => {
    const bus = createFakeBus();
    const a = createChatStore({ onEvent: bus.onEvent });
    a.setState({ boundSessionId: 's1', generation: 2 });
    bus.emit('piRuntime.event', envelope('s1', 1, 'run.started'));
    expect(a.getState().isStreaming).toBe(false);
  });

  it('sessionReplaced：异会话推送只被 expectingReplacement 的实例接受并改绑', () => {
    const bus = createFakeBus();
    const a = createChatStore({ onEvent: bus.onEvent });
    const b = createChatStore({ onEvent: bus.onEvent });
    a.setState({ boundSessionId: 's1', generation: 1, expectingReplacement: true });
    b.setState({ boundSessionId: 's2', generation: 1 });

    // a 发起 newSession 后的替换推送：a 改绑 s1-new，b 不受影响
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s1-new', 2));
    expect(a.getState().boundSessionId).toBe('s1-new');
    expect(a.getState().generation).toBe(2);
    expect(a.getState().expectingReplacement).toBe(false);
    expect(b.getState().boundSessionId).toBe('s2');
    expect(b.getState().generation).toBe(1);

    // 无 expectingReplacement 的实例不接受异会话推送
    bus.emit('piRuntime.sessionReplaced', stateSnapshot('s3', 3));
    expect(b.getState().boundSessionId).toBe('s2');
  });

  it('uiRequest 只进匹配实例，uiCancel 按 requestId 出队', () => {
    const bus = createFakeBus();
    const a = createChatStore({ onEvent: bus.onEvent });
    const b = createChatStore({ onEvent: bus.onEvent });
    a.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1 });
    b.setState({ boundSessionId: 's2', sessionId: 's2', generation: 1 });

    bus.emit('piRuntime.uiRequest', uiRequest('s1', 1, 'r1'));
    expect(a.getState().uiRequests.map((r) => r.requestId)).toEqual(['r1']);
    expect(b.getState().uiRequests).toEqual([]);

    bus.emit('piRuntime.uiCancel', { requestId: 'r1' });
    expect(a.getState().uiRequests).toEqual([]);
  });

  it('dispose 后退订，事件不再进入实例', () => {
    const bus = createFakeBus();
    const a = createChatStore({ onEvent: bus.onEvent });
    a.setState({ boundSessionId: 's1', generation: 1 });
    a.dispose();
    bus.emit('piRuntime.event', envelope('s1', 1, 'run.started'));
    expect(a.getState().isStreaming).toBe(false);
  });

  it('通知上报随实例走（reporters 注入）', () => {
    const bus = createFakeBus();
    const reporters = { runCompleted: vi.fn(), uiRequest: vi.fn() };
    const a = createChatStore({ onEvent: bus.onEvent, reporters });
    const b = createChatStore({ onEvent: bus.onEvent, reporters });
    a.setState({ boundSessionId: 's1', generation: 1 });
    b.setState({ boundSessionId: 's2', generation: 1 });

    bus.emit('piRuntime.uiRequest', uiRequest('s2', 1, 'r2'));
    expect(reporters.uiRequest).toHaveBeenCalledTimes(1);
    expect(reporters.uiRequest).toHaveBeenCalledWith('req-r2');
  });

  it('绑定会话文件后 prompt 走 scoped client（信封带 sessionPath）', async () => {
    const requests: HostRequest[] = [];
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          requests.push(request);
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
    try {
      const store = createChatStore();
      // 未绑定：回退窗口级调用，信封不带 sessionPath
      await store.getState().prompt('hello');
      expect(requests[0]).not.toHaveProperty('sessionPath');

      store.setState({ boundSessionId: 's1', boundSessionPath: '/tmp/s1.jsonl', generation: 1 });
      await store.getState().prompt('hello again');
      expect(requests[1]).toMatchObject({
        module: 'piRuntime',
        action: 'prompt',
        sessionPath: '/tmp/s1.jsonl',
      });
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
