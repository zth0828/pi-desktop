// 分栏布局树的窗口级单例（多面板 P3）：装配 panes.ts 的真实依赖——chat store 实例
// 创建/注册/销毁（chat-core + chat-registry）与活跃指针同步。node 侧单测请直接引用
// stores/panes.ts 的 createPanesStore 工厂（本模块经 default-chat-store 依赖 window 桥）。
import { onHostEvent } from '../lib/host-events';
import { reportRunCompleted, reportUiRequest } from '../lib/notify';
import { createChatStore, type ChatStore } from './chat-core';
import { getChatStore, registerChatStore, setActiveChatStoreId, unregisterChatStore } from './chat-registry';
import { DEFAULT_CHAT_STORE_ID, defaultChatStore } from './default-chat-store';
import { createPanesStore } from './panes';

// 实例绑定回写叶子目标：start/switch/newSession 后 boundSessionPath 变化时同步 sessionPath，
// 侧栏"已打开"标记与 findPaneBySession 据此保持新鲜。unsub 随 closePane 清理。
const unwatchers = new Map<string, () => void>();

function watchBinding(paneId: string, store: ChatStore): void {
  let last = store.getState().boundSessionPath;
  unwatchers.set(paneId, store.subscribe((state) => {
    if (state.boundSessionPath === last) return;
    last = state.boundSessionPath;
    panesStore.getState().syncPaneSession(paneId, state.boundSessionPath);
  }));
}

export const panesStore = createPanesStore(
  {
    create: (paneId) => {
      const store = createChatStore({
        onEvent: onHostEvent,
        reporters: { runCompleted: reportRunCompleted, uiRequest: reportUiRequest },
      });
      registerChatStore(paneId, store);
      watchBinding(paneId, store);
      return store;
    },
    destroy: (paneId) => {
      unwatchers.get(paneId)?.();
      unwatchers.delete(paneId);
      getChatStore(paneId)?.dispose();
      unregisterChatStore(paneId);
    },
    get: getChatStore,
    setActive: setActiveChatStoreId,
  },
  { paneId: DEFAULT_CHAT_STORE_ID },
);

// 窗口首个面板（默认实例在 default-chat-store 模块加载时已注册）也挂 watcher
watchBinding(DEFAULT_CHAT_STORE_ID, defaultChatStore);
