// host-invoke：ctx.sessionPath 优先级 =
// 信封显式 sessionPath → 窗口绑定（resolveWindowSession）→ null（走全局 active）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostActionContext } from '@electron/main/ipc/host-contract';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>(),
  windowSessions: new Map<number, string>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
      h.handlers.set(channel, handler);
    },
  },
}));

vi.mock('@electron/main/window-manager', () => ({
  resolveWindowSession: (webContentsId: number) => h.windowSessions.get(webContentsId) ?? null,
}));

import { HostApiRegistry, registerHostInvokeHandler } from '@electron/main/ipc/host-invoke';

type Captured = { ctx?: HostActionContext; payload?: unknown };
let captured: Captured;

function setup(): (event: unknown, request: unknown) => Promise<unknown> {
  const registry = new HostApiRegistry();
  registry.registerCoreServices({
    piRuntime: {
      getState: ((payload: unknown, ctx?: HostActionContext) => {
        captured = { ctx, payload };
        return null;
      }) as never,
    },
  });
  registerHostInvokeHandler(registry);
  return h.handlers.get('host:invoke')!;
}

function invoke(senderId: number, request: Record<string, unknown>) {
  return setup()({ sender: { id: senderId } }, request);
}

const baseRequest = { id: 'req-1', module: 'piRuntime', action: 'getState' };

beforeEach(() => {
  h.windowSessions.clear();
});

describe('host-invoke 显式 sessionPath 寻址（P1）', () => {
  it('信封显式 sessionPath 优先于窗口绑定', async () => {
    h.windowSessions.set(1, '/tmp/window-bound.jsonl');
    const res = await invoke(1, { ...baseRequest, sessionPath: '/tmp/explicit.jsonl' }) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(captured.ctx?.sessionPath).toBe('/tmp/explicit.jsonl');
  });

  it('无显式 sessionPath 时回退窗口绑定', async () => {
    h.windowSessions.set(1, '/tmp/window-bound.jsonl');
    await invoke(1, baseRequest);
    expect(captured.ctx?.sessionPath).toBe('/tmp/window-bound.jsonl');
  });

  it('显式与窗口绑定都没有时 sessionPath 为 null（走全局 active）', async () => {
    await invoke(999, baseRequest);
    expect(captured.ctx?.sessionPath).toBeNull();
  });

  it('sender 透传进 ctx', async () => {
    await invoke(7, { ...baseRequest, sessionPath: '/tmp/explicit.jsonl' });
    expect(captured.ctx?.sender).toEqual({ id: 7 });
  });

  it('sessionPath 存在但非 string 时判定为非法请求（VALIDATION）', async () => {
    const res = await invoke(1, { ...baseRequest, sessionPath: 123 }) as {
      ok: boolean;
      error?: { code?: string };
    };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('VALIDATION');
  });
});
