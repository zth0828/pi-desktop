// 面板作用域的 chat store Context：每个 ChatPane 一个 store 实例。
// 面板内组件一律用 usePaneChatStore(selector) 订阅（细粒度 selector，禁止无 selector
// 全量订阅）；窗口级语义的消费方（侧栏/设置页等）用 useActiveChatStore / getActiveChatStore。
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ChatState, ChatStore } from '../../stores/chat-core';
import { getActiveChatStore, getChatStore } from '../../stores/chat-registry';
import { panesStore } from '../../stores/panes-default';
import { hostApi, scopedHostApi, type HostApi } from '../../lib/host-api';

const ChatStoreContext = createContext<ChatStore | null>(null);

export function ChatStoreProvider({ store, children }: { store: ChatStore; children: ReactNode }) {
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

/** 取本面板的 store 实例（命令式 getState() 场景，如事件回调里的 applyModelUpdate） */
export function usePaneChatStoreApi(): ChatStore {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error('usePaneChatStore 必须在 ChatStoreProvider 内使用');
  return store;
}

export function usePaneChatStore<T>(selector: (state: ChatState) => T): T {
  return useStore(usePaneChatStoreApi(), selector);
}

/**
 * 面板作用域 host client：按本面板 boundSessionPath 返回 scopedHostApi，
 * 未绑定回退窗口级 hostApi（同 chat-core 内部 api() 语义）。scopedHostApi 按路径缓存，
 * 渲染期引用稳定；只有绑定变化才触发重渲染。
 */
export function usePaneHostApi(): HostApi {
  const boundSessionPath = usePaneChatStore((s) => s.boundSessionPath);
  return boundSessionPath ? scopedHostApi(boundSessionPath) : hostApi;
}

/**
 * 窗口级语义：订阅活跃面板实例的字段。活跃指针跟随分栏树 activePaneId（
 * 订阅 panes store 再映射实例 selector，activePaneId 不变时不产生多余重渲染）。
 */
export function useActiveChatStore<T>(selector: (state: ChatState) => T): T {
  const activePaneId = useStore(panesStore, (s) => s.activePaneId);
  const store = getChatStore(activePaneId) ?? getActiveChatStore();
  if (!store) throw new Error('尚未注册 chat store 实例');
  return useStore(store, selector);
}
