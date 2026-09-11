// chat store 实例隔离——两个 createChatStore() 实例绑定不同会话，
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
    // 未绑定会话文件（in-memory）时第二参为 undefined
    expect(reporters.uiRequest).toHaveBeenCalledWith('req-r2', undefined);
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

  it('压缩期间发送的 prompt 会延后到压缩完成并保留图片与投递方式', async () => {
    const bus = createFakeBus();
    const promptRequests: HostRequest[] = [];
    let resolveState!: () => void;
    const stateReady = new Promise<void>((resolve) => {
      resolveState = resolve;
    });
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          if (request.action === 'prompt') {
            promptRequests.push(request);
            return { id: request.id, ok: true, data: { success: true } };
          }
          if (request.action === 'getState') {
            await stateReady;
            return { id: request.id, ok: true, data: { ...stateSnapshot('s1', 1), sessionFile: '/tmp/s1.jsonl' } };
          }
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
    try {
      const store = createChatStore({ onEvent: bus.onEvent });
      store.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1, boundSessionPath: '/tmp/s1.jsonl' });

      bus.emit('piRuntime.event', {
        sessionId: 's1',
        generation: 1,
        at: Date.now(),
        event: { type: 'compaction.started', reason: 'manual' },
      } as PiRuntimeEventEnvelope);

      await store.getState().prompt(
        'message during compaction',
        [{ type: 'image', data: 'base64-image', mimeType: 'image/png' }],
        'followUp',
      );
      await store.getState().prompt('second message during compaction');
      expect(promptRequests).toHaveLength(0);

      bus.emit('piRuntime.event', {
        sessionId: 's1',
        generation: 1,
        at: Date.now(),
        event: { type: 'compaction.ended', reason: 'manual', result: { tokensBefore: 239039, estimatedTokensAfter: 102904, usage: { input: 682, output: 2654, cacheRead: 0, cacheWrite: 0, cost: 0 } } },
      } as PiRuntimeEventEnvelope);
      resolveState();

      await vi.waitFor(() => {
        expect(promptRequests).toHaveLength(2);
      });
      expect(promptRequests.map((request) => (request.payload as { text: string }).text)).toEqual([
        'message during compaction',
        'second message during compaction',
      ]);
      expect(promptRequests[0]).toMatchObject({
        module: 'piRuntime',
        action: 'prompt',
        sessionPath: '/tmp/s1.jsonl',
        payload: {
          text: 'message during compaction',
          images: [{ type: 'image', data: 'base64-image', mimeType: 'image/png' }],
          behavior: 'followUp',
        },
      });
      expect(store.getState().lastCompaction).toBeNull();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('压缩期间发送新消息会立即清除旧的压缩结果提示', async () => {
    const store = createChatStore();
    store.setState({
      boundSessionId: 's1',
      sessionId: 's1',
      generation: 1,
      compaction: { reason: 'manual' },
      lastCompaction: {
        tokensBefore: 239039,
        estimatedTokensAfter: 102904,
        usage: { input: 682, output: 2654, cacheRead: 0, cacheWrite: 0, cost: 0 },
      },
    });

    await store.getState().prompt('queued message');

    expect(store.getState().lastCompaction).toBeNull();
  });

  it('重试等待期间保持运行态，直到最终 run.ended 才结束', () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    store.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1, running: true, isStreaming: true });

    bus.emit('piRuntime.event', {
      sessionId: 's1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended', willRetry: true },
    } as PiRuntimeEventEnvelope);

    expect(store.getState().running).toBe(true);
    expect(store.getState().isStreaming).toBe(false);

    bus.emit('piRuntime.event', {
      sessionId: 's1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended', willRetry: false },
    } as PiRuntimeEventEnvelope);

    expect(store.getState().running).toBe(false);
  });

  it('compaction 事件尚未到达时 pi 拒绝 prompt 也会自动重试，而不是吞掉', async () => {
    const bus = createFakeBus();
    const promptRequests: HostRequest[] = [];
    let promptAttempts = 0;
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          if (request.action === 'prompt') {
            promptRequests.push(request);
            promptAttempts += 1;
            if (promptAttempts === 1) {
              return {
                id: request.id,
                ok: true,
                data: {
                  success: false,
                  error: 'Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.',
                },
              };
            }
            return { id: request.id, ok: true, data: { success: true } };
          }
          if (request.action === 'getState') {
            return { id: request.id, ok: true, data: stateSnapshot('s1', 1) };
          }
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
    try {
      const store = createChatStore({ onEvent: bus.onEvent });
      store.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1 });

      await store.getState().prompt('race-safe message');
      expect(promptRequests).toHaveLength(1);
      expect(store.getState().runtimeError).toBeUndefined();

      bus.emit('piRuntime.event', {
        sessionId: 's1',
        generation: 1,
        at: Date.now(),
        event: { type: 'compaction.started', reason: 'manual' },
      } as PiRuntimeEventEnvelope);
      bus.emit('piRuntime.event', {
        sessionId: 's1',
        generation: 1,
        at: Date.now(),
        event: { type: 'compaction.ended', reason: 'manual' },
      } as PiRuntimeEventEnvelope);

      await vi.waitFor(() => {
        expect(promptRequests).toHaveLength(2);
      });
      expect((promptRequests[1].payload as { text: string }).text).toBe('race-safe message');
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('切换会话时不会把旧会话待发送的 prompt 投递到新会话，切回后仍会继续发送', async () => {
    const promptRequests: HostRequest[] = [];
    let promptAttempts = 0;
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          if (request.action === 'prompt') {
            promptRequests.push(request);
            promptAttempts += 1;
            if (promptAttempts === 1) {
              return {
                id: request.id,
                ok: true,
                data: {
                  success: false,
                  error: 'Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.',
                },
              };
            }
            return { id: request.id, ok: true, data: { success: true } };
          }
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
    try {
      const store = createChatStore();
      store.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1, boundSessionPath: '/tmp/s1.jsonl' });

      await store.getState().prompt('keep for s1');
      store.getState().applyState({
        ...stateSnapshot('s2', 2),
        sessionFile: '/tmp/s2.jsonl',
      });

      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(promptRequests).toHaveLength(1);

      store.getState().applyState({
        ...stateSnapshot('s1', 1),
        sessionFile: '/tmp/s1.jsonl',
      });
      await vi.waitFor(() => {
        expect(promptRequests).toHaveLength(2);
      });
      expect(promptRequests[1]).toMatchObject({
        module: 'piRuntime',
        action: 'prompt',
        sessionPath: '/tmp/s1.jsonl',
        payload: { text: 'keep for s1' },
      });
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('compaction.ended 后 refreshMessages 用完整分支历史（messages 仍为压缩上下文）', async () => {
    const bus = createFakeBus();
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          if (request.action === 'getState') {
            return {
              id: request.id,
              ok: true,
              data: {
                sessionId: 's1',
                cwd: '/tmp/ws',
                generation: 1,
                thinkingLevel: 'off',
                availableThinkingLevels: [],
                isStreaming: false,
                // 压缩后 pi 只暴露摘要 + 保留尾部
                messages: [
                  { role: 'compactionSummary', content: [{ type: 'text', text: 'summary' }] },
                  { role: 'user', content: [{ type: 'text', text: 'tail q' }] },
                  { role: 'assistant', content: [{ type: 'text', text: 'tail a' }] },
                ],
                // session entry 仍保留完整分支
                historyMessages: [
                  { role: 'user', content: [{ type: 'text', text: 'q1' }] },
                  { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
                  { role: 'user', content: [{ type: 'text', text: 'q2' }] },
                  { role: 'compactionSummary', content: [{ type: 'text', text: 'summary' }] },
                  { role: 'user', content: [{ type: 'text', text: 'tail q' }] },
                  { role: 'assistant', content: [{ type: 'text', text: 'tail a' }] },
                ],
                messageEntryIds: [null, 'e3', null],
                historyMessageEntryIds: ['e1', null, 'e2', null, 'e3', null],
                sessionFile: '/tmp/s1.jsonl',
              },
            };
          }
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
    try {
      const store = createChatStore({ onEvent: bus.onEvent });
      store.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1 });
      bus.emit('piRuntime.event', {
        sessionId: 's1',
        generation: 1,
        at: Date.now(),
        event: { type: 'compaction.ended', reason: 'manual' },
      } as PiRuntimeEventEnvelope);
      await vi.waitFor(() => {
        expect(store.getState().historyMessages).toHaveLength(6);
      });
      expect(store.getState().messages).toHaveLength(3);
      expect(store.getState().historyMessages[0].entryId).toBe('e1');
      expect(store.getState().historyMessages[3].role).toBe('compactionSummary');
      expect(store.getState().historyMessages[4].entryId).toBe('e3');
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('composer 草稿保存在面板 store 中，会话状态替换不会清空', () => {
    const store = createChatStore();
    store.getState().setComposerText('unsent draft');
    store.getState().setComposerAttachments([
      { kind: 'file', name: 'notes.txt', text: 'draft file' },
    ]);
    store.getState().applyState({
      sessionId: 'next-session',
      cwd: '/tmp/ws',
      generation: 2,
      thinkingLevel: 'off',
      availableThinkingLevels: [],
      isStreaming: false,
      messages: [],
      messageEntryIds: [],
    });
    expect(store.getState().composerText).toBe('unsent draft');
    expect(store.getState().composerAttachments).toEqual([
      { kind: 'file', name: 'notes.txt', text: 'draft file' },
    ]);
  });

  it('流式 partial / message.ended 同时追加到 messages 与 historyMessages', async () => {
    const bus = createFakeBus();
    const store = createChatStore({ onEvent: bus.onEvent });
    store.setState({ boundSessionId: 's1', sessionId: 's1', generation: 1 });
    bus.emit('piRuntime.event', {
      sessionId: 's1',
      generation: 1,
      at: Date.now(),
      event: {
        type: 'assistant.partial',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hel' }] },
      },
    } as PiRuntimeEventEnvelope);
    await vi.waitFor(() => {
      expect(store.getState().messages).toHaveLength(1);
    });
    expect(store.getState().historyMessages).toHaveLength(1);
    bus.emit('piRuntime.event', {
      sessionId: 's1',
      generation: 1,
      at: Date.now(),
      event: {
        type: 'message.ended',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      },
    } as PiRuntimeEventEnvelope);
    await vi.waitFor(() => {
      expect(store.getState().messages[0]?.content[0]?.text).toBe('hello');
    });
    expect(store.getState().historyMessages[0]?.content[0]?.text).toBe('hello');
    expect(store.getState().messages[0]?.streaming).toBeFalsy();
  });
});
