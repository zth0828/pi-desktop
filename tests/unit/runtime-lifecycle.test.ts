// runtime-lifecycle 与 fork/edit 竞态状态机测试：
// 1. forkFrom 在流式/运行中时安全 abort 并暂存，由 run.ended 唤醒执行，避免 session is streaming / not started
// 2. afterSessionReplaced 在主窗口发起时正确更新全局 active，杜绝 active 悬空
// 3. maybeDisposeRuntime 在主窗口存活时保护后台运行会话，不施加 60 秒强杀定时器
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRequest } from '@shared/host-api/types';
import type { PiRuntimeEventEnvelope } from '@shared/pi-event-map';
import { createChatStore, type ChatStore, type HostEventSubscriber } from '@/stores/chat';

class FakeBrowserWindow {
  static sequence = 0;
  static instances: FakeBrowserWindow[] = [];
  static getAllWindows() {
    return FakeBrowserWindow.instances.filter((w) => !w.destroyed);
  }
  webContents = {
    id: ++FakeBrowserWindow.sequence,
    send: vi.fn(),
    isDestroyed: () => false,
  };
  private listeners = new Map<string, Array<() => void>>();
  destroyed = false;
  constructor() {
    FakeBrowserWindow.instances.push(this);
  }
  on(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
    for (const cb of this.listeners.get('closed') ?? []) cb();
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => false, resize: () => ({ isEmpty: () => false }) }),
  },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 875 } }),
  },
  app: {
    isPackaged: false,
    focus: () => {},
    on: () => {},
  },
}));

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

describe('chat-core forkFrom 与 editMessage 保护', () => {
  let invokedActions: Array<{ module: string; action: string; payload: unknown }> = [];

  function installBridge(forkResponder?: (entryId: string) => { success: boolean; error?: string; selectedText?: string }) {
    invokedActions = [];
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          invokedActions.push({ module: request.module, action: request.action, payload: request.payload });
          if (request.module === 'piRuntime' && request.action === 'fork') {
            const payload = request.payload as { entryId: string };
            const res = forkResponder ? forkResponder(payload.entryId) : { success: true, selectedText: 'forked prompt' };
            return { id: request.id, ok: true, data: res };
          }
          if (request.module === 'piRuntime' && request.action === 'abort') {
            return { id: request.id, ok: true, data: { success: true } };
          }
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
  }

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('在空闲状态下调用 forkFrom：直接执行 piRuntime.fork 并回填 inputDraft', async () => {
    installBridge();
    const bus = createFakeBus();
    const store: ChatStore = createChatStore({ onEvent: bus.onEvent });
    store.setState({
      boundSessionId: 's1',
      running: false,
      isStreaming: false,
      messages: [
        {
          role: 'user',
          entryId: 'entry-1',
          content: [{ type: 'text', text: 'hello' }],
          timestamp: 1000,
          raw: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        },
      ],
    });

    await store.getState().forkFrom('entry-1');

    const forkCall = invokedActions.find((a) => a.module === 'piRuntime' && a.action === 'fork');
    expect(forkCall).toBeDefined();
    expect((forkCall?.payload as { entryId: string }).entryId).toBe('entry-1');
    expect(store.getState().inputDraft?.text).toBe('hello');
  });

  it('在运行中调用 forkFrom：先触发 abort 并置位 pendingEditEntryId，run.ended 到来后再执行 fork', async () => {
    installBridge();
    const bus = createFakeBus();
    const store: ChatStore = createChatStore({ onEvent: bus.onEvent });
    store.setState({
      boundSessionId: 's1',
      generation: 1,
      running: true,
      isStreaming: true,
      messages: [
        {
          role: 'user',
          entryId: 'entry-1',
          content: [{ type: 'text', text: 'prompt to edit' }],
          timestamp: 1000,
          raw: { role: 'user', content: [{ type: 'text', text: 'prompt to edit' }] },
        },
      ],
    });

    // 运行中调用 forkFrom
    await store.getState().forkFrom('entry-1');

    // 此时应已调用 abort，但尚未调用 fork
    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'abort')).toBe(true);
    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'fork')).toBe(false);
    expect(store.getState().pendingEditEntryId).toBe('entry-1');

    // run.ended 事件到达
    const envelope: PiRuntimeEventEnvelope = {
      sessionId: 's1',
      generation: 1,
      at: Date.now(),
      event: { type: 'run.ended' } as PiRuntimeEventEnvelope['event'],
    };
    bus.emit('piRuntime.event', envelope);

    // 等待微任务队列执行完毕
    await new Promise((r) => setTimeout(r, 10));

    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'fork')).toBe(true);
    expect(store.getState().pendingEditEntryId).toBeNull();
  });

  it('editMessage 统一复用 forkFrom 的流式状态拦截与恢复逻辑', async () => {
    installBridge();
    const bus = createFakeBus();
    const store: ChatStore = createChatStore({ onEvent: bus.onEvent });
    store.setState({
      boundSessionId: 's1',
      generation: 1,
      running: true,
      isStreaming: true,
      messages: [
        {
          role: 'user',
          entryId: 'entry-user-2',
          content: [{ type: 'text', text: 'modify me' }],
          timestamp: 1000,
          raw: { role: 'user', content: [{ type: 'text', text: 'modify me' }] },
        },
      ],
    });

    await store.getState().editMessage('entry-user-2');

    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'abort')).toBe(true);
    expect(store.getState().pendingEditEntryId).toBe('entry-user-2');
  });
});

describe('electron pi-runtime-api 生命周期与寻址逻辑', () => {
  let wm: typeof import('@electron/main/window-manager');
  let piRuntimeApi: typeof import('@electron/services/pi-runtime-api');

  beforeEach(async () => {
    vi.resetModules();
    wm = await import('@electron/main/window-manager');
    piRuntimeApi = await import('@electron/services/pi-runtime-api');
  });

  afterEach(() => {
    for (const win of [...FakeBrowserWindow.instances]) {
      win.destroy();
    }
    FakeBrowserWindow.instances = [];
    piRuntimeApi.disposeAllRuntimes();
  });

  function createMockRuntime(options: {
    sessionId: string;
    sessionFile: string;
    running?: boolean;
    isStreaming?: boolean;
    abortFn?: () => void;
    disposeFn?: () => void;
  }) {
    return {
      sessionId: options.sessionId,
      instanceId: `inst-${options.sessionId}`,
      cwd: '/tmp/ws',
      generation: 1,
      running: options.running ?? false,
      mcpStatus: {},
      sessionFile: options.sessionFile,
      unsubscribe: () => {},
      adapter: {
        dispose: options.disposeFn ?? vi.fn(),
        packageVersion: '1.0.0',
        settings: {
          reload: async () => {},
          getBranchSummarySkipPrompt: () => false,
        },
      },
      adapterRuntime: {
        session: {
          sessionId: options.sessionId,
          sessionFile: options.sessionFile,
          abort: options.abortFn ?? vi.fn(),
          subscribe: () => () => {},
          getActiveBranchEntries: () => [],
          getAvailableThinkingLevels: () => [],
          getBranch: () => [],
          buildContextEntries: () => [],
          getContextUsage: () => undefined,
          getModelContextMessages: () => [],
          getSteeringMessages: () => [],
          getFollowUpMessages: () => [],
          view: {
            sessionFile: options.sessionFile,
            isStreaming: options.isStreaming ?? false,
          },
          messages: [],
          thinkingLevel: 'off',
        },
      },
    } as unknown as Parameters<typeof piRuntimeApi.activateSessionRuntime>[0];
  }

  it('resolveRuntimeForContext：当主窗口发送带 sessionPath 的请求且无独立保活项时，能安全兜底回退全局 active', () => {
    const mainWin = new FakeBrowserWindow() as unknown as import('electron').BrowserWindow;
    wm.registerWindow(mainWin, { isMain: true });

    const mockRuntime = createMockRuntime({
      sessionId: 'sess-active',
      sessionFile: '/tmp/ws/active.jsonl',
    });

    piRuntimeApi.activateSessionRuntime(mockRuntime);

    // 主窗口发送显式 sessionPath，但 runtimes 集合里只有全局 active
    const resolved = piRuntimeApi.resolveRuntimeForContext({
      sessionPath: '/tmp/ws/active.jsonl',
      sender: { id: mainWin.webContents.id },
    });

    expect(resolved).toBe(mockRuntime);
  });

  it('afterSessionReplaced：主窗口发起的会话替换必须更新全局 active', async () => {
    const mainWin = new FakeBrowserWindow() as unknown as import('electron').BrowserWindow;
    wm.registerWindow(mainWin, { isMain: true });

    const newRuntime = createMockRuntime({
      sessionId: 'sess-new',
      sessionFile: '/tmp/ws/new.jsonl',
    });

    await piRuntimeApi.afterSessionReplaced(newRuntime, {
      sender: mainWin.webContents as unknown as import('electron').WebContents,
      sessionPath: '/tmp/ws/old.jsonl',
    });

    // 检查经过主窗口 afterSessionReplaced 后，resolveRuntimeForContext 回退能取到新 runtime
    const currentActive = piRuntimeApi.resolveRuntimeForContext();
    expect(currentActive).toBe(newRuntime);
  });

  it('maybeDisposeRuntime：主窗口存活时，后台运行任务不得启动 60 秒强杀定时器', async () => {
    const mainWin = new FakeBrowserWindow() as unknown as import('electron').BrowserWindow;
    wm.registerWindow(mainWin, { isMain: true });

    const abortFn = vi.fn();
    const backgroundRuntime = createMockRuntime({
      sessionId: 'sess-bg',
      sessionFile: '/tmp/ws/bg.jsonl',
      running: true,
      isStreaming: true,
      abortFn,
    });

    // 提前启用假定时器以捕获内部 setTimeout
    vi.useFakeTimers();
    try {
      // 先激活为 active，然后再切到另一个 runtime
      piRuntimeApi.activateSessionRuntime(backgroundRuntime);

      const foregroundRuntime = createMockRuntime({
        sessionId: 'sess-fg',
        sessionFile: '/tmp/ws/fg.jsonl',
      });

      // 切到前台 runtime，此时 backgroundRuntime 会被传入 maybeDisposeRuntime
      piRuntimeApi.activateSessionRuntime(foregroundRuntime);

      // 推进 65 秒（超过原有的 60 秒 PENDING_DISPOSE_TIMEOUT_MS）
      vi.advanceTimersByTime(65_000);

      // 核心断言：因为主窗口存活，后台任务绝不能被 abort 强杀！
      expect(abortFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('多会话并发（>= 3 个会话）：在多个并发运行的会话之间切换，无任何会话被 60 秒定时器误杀', async () => {
    const mainWin = new FakeBrowserWindow() as unknown as import('electron').BrowserWindow;
    wm.registerWindow(mainWin, { isMain: true });

    const abort1 = vi.fn();
    const abort2 = vi.fn();
    const abort3 = vi.fn();

    const r1 = createMockRuntime({ sessionId: 's1', sessionFile: '/tmp/ws/s1.jsonl', running: true, isStreaming: true, abortFn: abort1 });
    const r2 = createMockRuntime({ sessionId: 's2', sessionFile: '/tmp/ws/s2.jsonl', running: true, isStreaming: true, abortFn: abort2 });
    const r3 = createMockRuntime({ sessionId: 's3', sessionFile: '/tmp/ws/s3.jsonl', running: true, isStreaming: true, abortFn: abort3 });

    vi.useFakeTimers();
    try {
      // 模拟用户并发启动 3 个会话并依次切换
      piRuntimeApi.activateSessionRuntime(r1);
      piRuntimeApi.activateSessionRuntime(r2);
      piRuntimeApi.activateSessionRuntime(r3);

      // 推进 120 秒（远超 60 秒硬超时）
      vi.advanceTimersByTime(120_000);

      // 3 个会话均在健康运行，没有一个被 force-dispose abort 强杀
      expect(abort1).not.toHaveBeenCalled();
      expect(abort2).not.toHaveBeenCalled();
      expect(abort3).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('会话被窗口观看时（findWindowBySession 不为空），即使非 active 也不得回收', () => {
    const detachedWin = new FakeBrowserWindow() as unknown as import('electron').BrowserWindow;
    wm.registerWindow(detachedWin, { sessionPath: '/tmp/ws/watched.jsonl' });

    const disposeFn = vi.fn();
    const watchedRuntime = createMockRuntime({
      sessionId: 'sess-watched',
      sessionFile: '/tmp/ws/watched.jsonl',
      running: false,
      disposeFn,
    });

    piRuntimeApi.activateSessionRuntime(watchedRuntime);

    const otherRuntime = createMockRuntime({
      sessionId: 'sess-other',
      sessionFile: '/tmp/ws/other.jsonl',
      running: false,
    });

    // 切到 otherRuntime，watchedRuntime 虽非 active，但有窗口在看它，不得回收
    piRuntimeApi.activateSessionRuntime(otherRuntime);

    expect(disposeFn).not.toHaveBeenCalled();
  });

  it('未被任何窗口观看且已停止运行的会话，在切换后被立即物理回收', () => {
    const disposeFn = vi.fn();
    const unwatchedRuntime = createMockRuntime({
      sessionId: 'sess-unwatched',
      sessionFile: '/tmp/ws/unwatched.jsonl',
      running: false,
      disposeFn,
    });

    piRuntimeApi.activateSessionRuntime(unwatchedRuntime);

    const nextRuntime = createMockRuntime({
      sessionId: 'sess-next',
      sessionFile: '/tmp/ws/next.jsonl',
      running: false,
    });

    piRuntimeApi.activateSessionRuntime(nextRuntime);

    expect(disposeFn).toHaveBeenCalled();
  });

  it('无任何窗口存活（真正孤儿运行时）且处于流式运行时，启动 60 秒兜底超时防泄漏', () => {
    // 此时没有任何窗口注册（或窗口已全毁）
    vi.useFakeTimers();
    try {
      const abortFn = vi.fn();
      const orphanRuntime = createMockRuntime({
        sessionId: 'sess-orphan',
        sessionFile: '/tmp/ws/orphan.jsonl',
        running: true,
        isStreaming: true,
        abortFn,
      });

      piRuntimeApi.activateSessionRuntime(orphanRuntime);

      // 切走并触发回收判定
      const other = createMockRuntime({
        sessionId: 'sess-other-2',
        sessionFile: '/tmp/ws/other2.jsonl',
      });
      piRuntimeApi.activateSessionRuntime(other);

      // 没有主窗口存活且无窗口观看，此时启动了 60 秒兜底定时器
      vi.advanceTimersByTime(65_000);

      // 孤儿 runtime 超时兜底触发 abort 回收
      expect(abortFn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
