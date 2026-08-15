// 多面板 P3：分栏布局树 action 全覆盖（split 四方向/ratio clamp/close 兄弟上位/根不可关/
// openOrFocusSession 三分支/replacePane 复用实例改绑）。chat store 实例经 deps mock，node-safe。
import { describe, expect, it, vi } from 'vitest';
import type { HostSuccess } from '@shared/host-api/contract';
import type { ChatState, ChatStore } from '@/stores/chat-core';
import {
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  createPanesStore,
  type BranchNode,
  type LeafNode,
  type PanesDeps,
  type SplitNode,
} from '@/stores/panes';

type FakeInstance = {
  store: ChatStore;
  boundSessionPath: string | null;
  switchSession: ReturnType<typeof vi.fn>;
};

function makeDeps() {
  const instances = new Map<string, FakeInstance>();
  const created: string[] = [];
  const destroyed: string[] = [];
  const activeCalls: Array<string | null> = [];
  let switchResult: HostSuccess = { success: true };
  const deps: PanesDeps = {
    create: (paneId) => {
      created.push(paneId);
      const instance: FakeInstance = {
        boundSessionPath: null,
        switchSession: vi.fn(async (path: string) => {
          instance.boundSessionPath = path;
          return switchResult;
        }),
        store: undefined as unknown as ChatStore,
      };
      instance.store = {
        getState: () => ({
          boundSessionPath: instance.boundSessionPath,
          switchSession: instance.switchSession,
        }),
      } as unknown as ChatStore;
      instances.set(paneId, instance);
      return instance.store;
    },
    destroy: (paneId) => {
      destroyed.push(paneId);
      instances.delete(paneId);
    },
    get: (paneId) => instances.get(paneId)?.store,
    setActive: (id) => {
      activeCalls.push(id);
    },
  };
  return {
    deps,
    created,
    destroyed,
    activeCalls,
    instance: (paneId: string) => instances.get(paneId),
    setSwitchResult: (r: HostSuccess) => {
      switchResult = r;
    },
  };
}

function leafIds(root: SplitNode): string[] {
  if (root.type === 'leaf') return [root.paneId];
  return [...leafIds(root.children[0]), ...leafIds(root.children[1])];
}

function leaf(root: SplitNode, paneId: string): LeafNode {
  const found = (function walk(node: SplitNode): LeafNode | null {
    if (node.type === 'leaf') return node.paneId === paneId ? node : null;
    return walk(node.children[0]) ?? walk(node.children[1]);
  })(root);
  if (!found) throw new Error(`leaf not found: ${paneId}`);
  return found;
}

const SESSION_A = { sessionPath: '/sessions/a.jsonl', cwd: '/ws/a' };
const SESSION_B = { sessionPath: '/sessions/b.jsonl', cwd: '/ws/b' };

describe('panes 分栏布局树（多面板 P3）', () => {
  it('初始树 = 单叶子根，活跃指针指向它', () => {
    const { deps } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    expect(store.getState().root).toEqual({ type: 'leaf', paneId: 'default', sessionPath: null });
    expect(store.getState().activePaneId).toBe('default');
  });

  it('splitAt 四方向：left/right → row、top/bottom → column；left/top 新面板在前', () => {
    const { deps, created } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });

    const right = store.getState().splitAt('default', 'right', SESSION_A)!;
    let root = store.getState().root as BranchNode;
    expect(root.direction).toBe('row');
    expect(root.children[0]).toMatchObject({ paneId: 'default' });
    expect(root.children[1]).toMatchObject({ paneId: right });

    const left = store.getState().splitAt('default', 'left', SESSION_B)!;
    root = store.getState().root as BranchNode;
    const leftSplit = root.children[0] as BranchNode;
    expect(leftSplit.direction).toBe('row');
    expect(leftSplit.children.map((c) => (c as LeafNode).paneId)).toEqual([left, 'default']);

    const bottom = store.getState().splitAt(right, 'bottom', { sessionPath: '/sessions/c.jsonl' })!;
    const rightSplit = (store.getState().root as BranchNode).children[1] as BranchNode;
    expect(rightSplit.direction).toBe('column');
    expect(rightSplit.children.map((c) => (c as LeafNode).paneId)).toEqual([right, bottom]);

    const top = store.getState().splitAt(bottom, 'top', { sessionPath: '/sessions/d.jsonl' })!;
    const bottomSplit = rightSplit.children[1] as BranchNode;
    const refreshed = (store.getState().root as BranchNode).children[1] as BranchNode;
    const topSplit = refreshed.children[1] as BranchNode;
    expect(topSplit.direction).toBe('column');
    expect(topSplit.children.map((c) => (c as LeafNode).paneId)).toEqual([top, bottom]);
    expect(bottomSplit).not.toBeNull();
    expect(created).toEqual([right, left, bottom, top]);
  });

  it('splitAt：创建实例并 switchSession 改绑，新面板成为活跃面板', () => {
    const { deps, instance, activeCalls } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const paneId = store.getState().splitAt('default', 'right', SESSION_A)!;
    expect(instance(paneId)?.switchSession).toHaveBeenCalledWith(SESSION_A.sessionPath, SESSION_A.cwd);
    expect(store.getState().activePaneId).toBe(paneId);
    expect(activeCalls).toContain(paneId);
    expect(leaf(store.getState().root, paneId)).toMatchObject({ sessionPath: SESSION_A.sessionPath, sessionCwd: SESSION_A.cwd });
  });

  it('splitAt：目标叶子已是同一会话 = 无操作（只激活，不创建实例）', () => {
    const { deps, created } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const paneId = store.getState().splitAt('default', 'right', SESSION_A)!;
    created.length = 0;
    expect(store.getState().splitAt(paneId, 'left', SESSION_A)).toBeNull();
    expect(created).toEqual([]);
    expect(leafIds(store.getState().root)).toHaveLength(2);
  });

  it('splitAt：目标面板不存在 = null 无操作', () => {
    const { deps, created } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    expect(store.getState().splitAt('ghost', 'right', SESSION_A)).toBeNull();
    expect(created).toEqual([]);
  });

  it('setRatio：更新占比并 clamp 到 15%–85%', () => {
    const { deps } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    store.getState().splitAt('default', 'right', SESSION_A);
    const splitId = (store.getState().root as BranchNode).id;

    store.getState().setRatio(splitId, 0.3);
    expect((store.getState().root as BranchNode).ratio).toBe(0.3);
    store.getState().setRatio(splitId, 0.01);
    expect((store.getState().root as BranchNode).ratio).toBe(MIN_SPLIT_RATIO);
    store.getState().setRatio(splitId, 0.99);
    expect((store.getState().root as BranchNode).ratio).toBe(MAX_SPLIT_RATIO);
    store.getState().setRatio(splitId, Number.NaN);
    expect((store.getState().root as BranchNode).ratio).toBe(0.5);
  });

  it('closePane：兄弟节点上位取代父 split，实例销毁，活跃指针回退兄弟', () => {
    const { deps, destroyed, activeCalls } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const right = store.getState().splitAt('default', 'right', SESSION_A)!;
    const third = store.getState().splitAt(right, 'bottom', SESSION_B)!;

    // 关闭 third：其父 split 由兄弟 right 上位
    store.getState().closePane(third);
    expect(destroyed).toEqual([third]);
    const root = store.getState().root as BranchNode;
    expect(root.type).toBe('split');
    expect(leafIds(root)).toEqual(['default', right]);
    // 活跃面板是被关闭的 third → 回退到上位子树的首个叶子
    expect(store.getState().activePaneId).toBe(right);
    expect(activeCalls.at(-1)).toBe(right);

    // 关闭非活跃面板：活跃指针不动
    store.getState().activatePane(right);
    store.getState().closePane('default');
    expect(store.getState().root).toMatchObject({ type: 'leaf', paneId: right });
    expect(store.getState().activePaneId).toBe(right);
  });

  it('closePane：根面板（唯一叶子）不可关', () => {
    const { deps, destroyed } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    store.getState().closePane('default');
    expect(store.getState().root).toMatchObject({ type: 'leaf', paneId: 'default' });
    expect(destroyed).toEqual([]);
  });

  it('replacePane：复用实例调 switchSession 改绑（不新建实例），叶子目标更新', async () => {
    const { deps, created, instance } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const defaultInstance = instance('default');
    // 默认面板实例不在 create 里产生（初始叶子）：手工注入
    expect(defaultInstance).toBeUndefined();
    const paneId = store.getState().splitAt('default', 'right', SESSION_A)!;
    created.length = 0;

    const result = store.getState().replacePane(paneId, SESSION_B);
    expect(created).toEqual([]); // 复用实例
    expect(instance(paneId)?.switchSession).toHaveBeenLastCalledWith(SESSION_B.sessionPath, SESSION_B.cwd);
    await result;
    expect(leaf(store.getState().root, paneId).sessionPath).toBe(SESSION_B.sessionPath);
  });

  it('replacePane：switchSession 失败回滚叶子目标', async () => {
    const { deps, setSwitchResult } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const paneId = store.getState().splitAt('default', 'right', SESSION_A)!;
    setSwitchResult({ success: false, error: 'boom' });
    const result = store.getState().replacePane(paneId, SESSION_B);
    await result;
    expect(leaf(store.getState().root, paneId).sessionPath).toBe(SESSION_A.sessionPath);
  });

  it('replacePane：同会话 = 无操作只激活；目标不存在 = null', () => {
    const { deps, instance } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const paneId = store.getState().splitAt('default', 'right', SESSION_A)!;
    store.getState().activatePane('default');
    expect(store.getState().replacePane(paneId, SESSION_A)).toBeNull();
    expect(store.getState().activePaneId).toBe(paneId);
    expect(instance(paneId)?.switchSession).toHaveBeenCalledTimes(1);
    expect(store.getState().replacePane('ghost', SESSION_B)).toBeNull();
  });

  it('openOrFocusSession：已在某面板 → 只激活；否则替换活跃面板；活跃面板即该会话 → 无操作', async () => {
    const { deps, instance } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    const paneId = store.getState().splitAt('default', 'right', SESSION_A)!;

    // 已打开（命中实例实际绑定 boundSessionPath，而非叶子目标）
    store.getState().activatePane('default');
    expect(store.getState().findPaneBySession(SESSION_A.sessionPath)).toBe(paneId);
    expect(store.getState().openOrFocusSession(SESSION_A.sessionPath, SESSION_A.cwd)).toBeNull();
    expect(store.getState().activePaneId).toBe(paneId);
    expect(instance(paneId)?.switchSession).toHaveBeenCalledTimes(1); // 没有再次切换

    // 未打开 → 替换活跃面板
    const result = store.getState().openOrFocusSession(SESSION_B.sessionPath, SESSION_B.cwd);
    await result;
    expect(instance(paneId)?.switchSession).toHaveBeenLastCalledWith(SESSION_B.sessionPath, SESSION_B.cwd);
    expect(leaf(store.getState().root, paneId).sessionPath).toBe(SESSION_B.sessionPath);

    // 活跃面板即该会话 → 无操作
    expect(store.getState().openOrFocusSession(SESSION_B.sessionPath)).toBeNull();
    expect(instance(paneId)?.switchSession).toHaveBeenCalledTimes(2);
  });

  it('activatePane：未知 paneId 无操作', () => {
    const { deps, activeCalls } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    store.getState().activatePane('ghost');
    expect(store.getState().activePaneId).toBe('default');
    expect(activeCalls).toEqual([]);
  });

  it('syncPaneSession：实例实际绑定回写叶子目标', () => {
    const { deps } = makeDeps();
    const store = createPanesStore(deps, { paneId: 'default' });
    store.getState().syncPaneSession('default', SESSION_A.sessionPath);
    expect(leaf(store.getState().root, 'default').sessionPath).toBe(SESSION_A.sessionPath);
    expect(store.getState().findPaneBySession(SESSION_A.sessionPath)).toBe('default');
    // 幂等：同值不再 set
    const before = store.getState().root;
    store.getState().syncPaneSession('default', SESSION_A.sessionPath);
    expect(store.getState().root).toBe(before);
  });
});
