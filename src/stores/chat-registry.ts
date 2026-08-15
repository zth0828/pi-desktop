// chat store 实例注册表：面板 id → store 实例。
// node-safe（不引 react）：单测直接引用。活跃面板指针由分栏布局树（stores/panes）驱动。
import type { ChatStore } from './chat-core';

const stores = new Map<string, ChatStore>();
let activeChatStoreId: string | null = null;

export function registerChatStore(id: string, store: ChatStore): void {
  stores.set(id, store);
  if (activeChatStoreId === null || !stores.has(activeChatStoreId)) activeChatStoreId = id;
}

export function unregisterChatStore(id: string): void {
  stores.delete(id);
  if (activeChatStoreId === id) activeChatStoreId = [...stores.keys()][0] ?? null;
}

export function getChatStore(id: string): ChatStore | undefined {
  return stores.get(id);
}

export function getAllChatStores(): ChatStore[] {
  return [...stores.values()];
}

export function getActiveChatStoreId(): string | null {
  return activeChatStoreId;
}

export function setActiveChatStoreId(id: string | null): void {
  activeChatStoreId = id;
}

/** 活跃面板实例；活跃指针缺失/失效时回退首个注册实例 */
export function getActiveChatStore(): ChatStore | undefined {
  if (activeChatStoreId) {
    const store = stores.get(activeChatStoreId);
    if (store) return store;
  }
  return stores.values().next().value;
}
