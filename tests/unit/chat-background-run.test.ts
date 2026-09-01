// 后台 run 跟踪：单面板切走会话时，若旧会话仍在运行，store 登记后台 run，
// 继续收它的流式文本，run.ended 到来自行上报完成通知（否则改绑后事件被丢、
// 通知永远不弹——用户「切到另一个会话后看不到完成通知」的根因）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import type { PiRuntimeStateResult } from '@shared/host-api/contract';
import type { HostRequest } from '@shared/host-api/types';
import { createChatStore, type ChatEventReporters, type ChatStore, type HostEventSubscriber } from '@/stores/chat';

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

/** mock window.pidesktop.hostInvoke：switch 走桥，getState 返回目标会话快照 */
function installBridge(): void {
  (globalThis as { window?: unknown }).window = {
    pidesktop: {
      hostInvoke: vi.fn(async (request: HostRequest) => {
        if (request.module === 'piSessions' && request.action === 'switch') {
          return { id: request.id, ok: true, data: { success: true } };
        }
        if (request.module === 'piRuntime' && request.action === 'getState') {
          const state: PiRuntimeStateResult = {
            sessionId: 's2',
            cwd: '/tmp/ws',
            generation: 1,
            thinkingLevel: 'off',
            availableThinkingLevels: [],
            isStreaming: false,
            messages: [],
            messageEntryIds: [],
            sessionFile: '/tmp/s2.jsonl',
          };
          return { id: request.id, ok: true, data: state };
        }
        return { id: request.id, ok: true, data: { success: true } };
      }),
    },
  };
}

function textPartial(text: string): PiRuntimeEventEnvelope {
  return {
    sessionId: 's1',
    generation: 1,
    at: Date.now(),
    event: {
      type: 'assistant.partial',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    } as PiRuntimeEventEnvelope['event'],
  };
}

function runEnded(sessionId: string): PiRuntimeEventEnvelope {
  return { sessionId, generation: 1, at: Date.now(), event: { type: 'run.ended' } as PiRuntimeEventEnvelope['event'] };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('chat store 后台 run 跟踪', () => {
  it('切走仍在运行的会话：run.ended 到来自行上报完成通知（带旧会话路径）', async () => {
    installBridge();
    const bus = createFakeBus();
    const runCompleted = vi.fn();
    const reporters: ChatEventReporters = { runCompleted, uiRequest: vi.fn() };
    const store: ChatStore = createChatStore({ onEvent: bus.onEvent, reporters });
    store.setState({
      boundSessionId: 's1',
      boundSessionPath: '/tmp/s1.jsonl',
      generation: 1,
      running: true,
      cwd: '/tmp/ws',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'initial-partial' }],
          streaming: true,
          timestamp: 0,
          raw: { role: 'assistant', content: [{ type: 'text', text: 'initial-partial' }] },
        },
      ],
    });

    // 切到 s2：s1 正在运行 → 登记后台 run，面板改绑 s2
    await store.getState().switchSession('/tmp/s2.jsonl');
    expect(store.getState().boundSessionId).toBe('s2');
    expect(runCompleted).not.toHaveBeenCalled();

    // s1 后续流式文本更新摘要；run.ended 触发上报（正文=最新摘要，sessionPath=旧会话）
    bus.emit('piRuntime.event', textPartial('final-summary'));
    bus.emit('piRuntime.event', runEnded('s1'));
    expect(runCompleted).toHaveBeenCalledWith('final-summary', '/tmp/s1.jsonl');
  });

  it('切走时未在运行（或刚提交未启动）：不登记，run.ended 不误报', async () => {
    installBridge();
    const bus = createFakeBus();
    const runCompleted = vi.fn();
    const store: ChatStore = createChatStore({
      onEvent: bus.onEvent,
      reporters: { runCompleted, uiRequest: vi.fn() },
    });
    store.setState({
      boundSessionId: 's1',
      boundSessionPath: '/tmp/s1.jsonl',
      generation: 1,
      running: false,
      cwd: '/tmp/ws',
      messages: [],
    });

    await store.getState().switchSession('/tmp/s2.jsonl');
    bus.emit('piRuntime.event', runEnded('s1'));
    expect(runCompleted).not.toHaveBeenCalled();
  });

  it('未跟踪会话的事件不触发上报（其他窗口的会话不受影响）', async () => {
    installBridge();
    const bus = createFakeBus();
    const runCompleted = vi.fn();
    const store: ChatStore = createChatStore({
      onEvent: bus.onEvent,
      reporters: { runCompleted, uiRequest: vi.fn() },
    });
    store.setState({
      boundSessionId: 's1',
      boundSessionPath: '/tmp/s1.jsonl',
      generation: 1,
      running: false,
      cwd: '/tmp/ws',
      messages: [],
    });

    bus.emit('piRuntime.event', runEnded('s3')); // 从未在本面板出现过
    expect(runCompleted).not.toHaveBeenCalled();
  });
});
