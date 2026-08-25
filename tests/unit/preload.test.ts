// preload onHostEvent：channel 白名单、每 channel 订阅计数阈值告警与退订回收。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

const h = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: h.exposeInMainWorld },
  ipcRenderer: { on: h.on, removeListener: h.removeListener },
}));

import '@electron/preload/index';

type ExposedApi = {
  onHostEvent: (channel: string, callback: (...args: unknown[]) => void) => () => void;
};

function api(): ExposedApi {
  const exposed = h.exposeInMainWorld.mock.calls[0]?.[1] as ExposedApi | undefined;
  if (!exposed) throw new Error('preload did not expose pidesktop API');
  return exposed;
}

beforeEach(() => {
  h.on.mockClear();
  h.removeListener.mockClear();
});

describe('preload onHostEvent', () => {
  it('合法 channel 注册监听，退订函数移除对应 listener', () => {
    const channel = HOST_EVENT_CHANNELS.menu.action;
    const off = api().onHostEvent(channel, () => {});
    expect(h.on).toHaveBeenCalledTimes(1);
    expect(h.on).toHaveBeenCalledWith(channel, expect.any(Function));

    off();
    expect(h.removeListener).toHaveBeenCalledWith(channel, h.on.mock.calls[0]?.[1]);
  });

  it('非法 channel 直接抛错', () => {
    expect(() => api().onHostEvent('not:a:channel', () => {}))
      .toThrow(/Invalid host event channel/);
  });

  it('同一 channel 订阅超过阈值时 console.warn，退订后计数回收', () => {
    const channel = HOST_EVENT_CHANNELS.piSystem.envChanged;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 第 21 个订阅越过阈值 20，告警一次
      const offs = Array.from({ length: 21 }, () => api().onHostEvent(channel, () => {}));
      expect(warn).toHaveBeenCalledTimes(1);

      offs.forEach((off) => off());
      // 计数归零后重新累积，阈值内不告警
      Array.from({ length: 20 }, () => api().onHostEvent(channel, () => {}));
      expect(warn).toHaveBeenCalledTimes(1);

      // 再次越过阈值会再次提醒，证明退订确实回收了计数
      api().onHostEvent(channel, () => {});
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining(channel));
    } finally {
      warn.mockRestore();
    }
  });
});
