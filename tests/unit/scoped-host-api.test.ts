// scopedHostApi（多面板 P1）：面板作用域 client 的信封透传、Map 缓存与同形性。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostApi, scopedHostApi } from '@/lib/host-api';
import type { HostRequest } from '@shared/host-api/types';

const requests: HostRequest[] = [];

(globalThis as { window?: unknown }).window = {
  pidesktop: {
    hostInvoke: vi.fn(async (request: HostRequest) => {
      requests.push(request);
      return { id: request.id, ok: true, data: null };
    }),
  },
};

beforeEach(() => {
  requests.length = 0;
});

function shape(value: unknown): unknown {
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, shape(v)]),
    );
  }
  return typeof value;
}

describe('scopedHostApi', () => {
  it('窗口级 hostApi 的信封不带 sessionPath', async () => {
    await hostApi.app.version();
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('sessionPath');
    expect(requests[0]).toMatchObject({ module: 'app', action: 'version' });
  });

  it('面板作用域调用自动在信封带显式 sessionPath（payload 不受影响）', async () => {
    const api = scopedHostApi('/tmp/pane-a.jsonl');
    await api.piRuntime.getState();
    expect(requests[0]).toMatchObject({
      module: 'piRuntime',
      action: 'getState',
      sessionPath: '/tmp/pane-a.jsonl',
    });

    await api.piSessions.switch('/tmp/other.jsonl', '/tmp/ws');
    expect(requests[1]).toMatchObject({
      module: 'piSessions',
      action: 'switch',
      sessionPath: '/tmp/pane-a.jsonl',
      payload: { path: '/tmp/other.jsonl', cwd: '/tmp/ws' },
    });
  });

  it('同 sessionPath 返回同一对象（Map 缓存），不同 sessionPath 互不共享', () => {
    const a1 = scopedHostApi('/tmp/pane-cache-a.jsonl');
    const a2 = scopedHostApi('/tmp/pane-cache-a.jsonl');
    const b = scopedHostApi('/tmp/pane-cache-b.jsonl');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('与 hostApi 同形（模块与方法结构一致）', () => {
    const api = scopedHostApi('/tmp/pane-shape.jsonl');
    expect(shape(api)).toEqual(shape(hostApi));
  });
});
