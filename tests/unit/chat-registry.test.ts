// chat store 实例注册表基本行为（注册/注销/活跃指针回退）。
import { afterEach, describe, expect, it } from 'vitest';
import { createChatStore } from '@/stores/chat';
import {
  getActiveChatStore,
  getActiveChatStoreId,
  getAllChatStores,
  getChatStore,
  registerChatStore,
  setActiveChatStoreId,
  unregisterChatStore,
} from '@/stores/chat-registry';

// 注册表是模块级单例：记录本文件注册过的 id，用例后全部注销，避免串场
const registeredIds: string[] = [];
let seq = 0;
function register() {
  const id = `test-pane-${(seq += 1)}`;
  const store = createChatStore();
  registerChatStore(id, store);
  registeredIds.push(id);
  return { id, store };
}

afterEach(() => {
  while (registeredIds.length > 0) unregisterChatStore(registeredIds.pop()!);
  setActiveChatStoreId(null);
});

describe('chat-registry', () => {
  it('register 后可按 id 取回同一实例；getAll 覆盖全部注册实例', () => {
    const a = register();
    const b = register();
    expect(getChatStore(a.id)).toBe(a.store);
    expect(getChatStore(b.id)).toBe(b.store);
    expect(getAllChatStores()).toEqual(expect.arrayContaining([a.store, b.store]));
  });

  it('首个注册实例自动成为活跃面板', () => {
    const a = register();
    expect(getActiveChatStoreId()).toBe(a.id);
    expect(getActiveChatStore()).toBe(a.store);
  });

  it('setActiveChatStoreId 切换活跃指针；getActiveChatStore 跟随', () => {
    const a = register();
    const b = register();
    setActiveChatStoreId(b.id);
    expect(getActiveChatStore()).toBe(b.store);
    setActiveChatStoreId(a.id);
    expect(getActiveChatStore()).toBe(a.store);
  });

  it('注销活跃实例后活跃指针回退到剩余首个实例', () => {
    const a = register();
    const b = register();
    setActiveChatStoreId(a.id);
    unregisterChatStore(a.id);
    registeredIds.splice(registeredIds.indexOf(a.id), 1);
    expect(getActiveChatStore()).toBe(b.store);
  });

  it('活跃指针指向已注销 id 时 getActiveChatStore 回退首个实例', () => {
    const a = register();
    setActiveChatStoreId('ghost-pane');
    expect(getActiveChatStore()).toBe(a.store);
  });
});
