// 窗口首个面板的默认 chat store 实例（多面板 P2：当前即唯一面板，?session= attach /
// workspaceCwd 恢复等"窗口首个面板"语义都落在它上面；P3 起新增面板由分栏树创建注册）。
// 模块加载即创建并注册，保证窗口级消费方（侧栏/设置页）任何时候都能拿到活跃实例。
import { onHostEvent } from '../lib/host-events';
import { reportRunCompleted, reportUiRequest } from '../lib/notify';
import { createChatStore } from './chat-core';
import { registerChatStore } from './chat-registry';

export const DEFAULT_CHAT_STORE_ID = 'default';

export const defaultChatStore = createChatStore({
  onEvent: onHostEvent,
  reporters: { runCompleted: reportRunCompleted, uiRequest: reportUiRequest },
});

registerChatStore(DEFAULT_CHAT_STORE_ID, defaultChatStore);
