// 订阅 Main → Renderer 的 host 事件（类型安全封装）。
import {
  HOST_EVENT_CHANNELS,
  type HostEventArgs,
  type HostEventModule,
  type HostEventName,
} from '@shared/host-events/contract';

export function onHostEvent<M extends HostEventModule, E extends HostEventName<M>>(
  module: M,
  event: E,
  handler: (...args: HostEventArgs<M, E>) => void,
): () => void {
  const channel = (HOST_EVENT_CHANNELS[module] as Record<string, string>)[event];
  return window.pidesktop.onHostEvent(channel, handler as (...args: unknown[]) => void);
}
