// 窗口级分栏布局树（多面板 P3，docs/MULTI-WINDOW-PANES-PLAN.md）：二叉分栏 + 活跃面板指针。
// node-safe 分层同 chat-core.ts：本模块不引 react / host-events，chat store 实例的
// 创建/销毁/注册表同步全部经 deps 注入（web 侧装配见 stores/panes-default.ts），
// node 侧单测用 mock 工厂直接引用。
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { HostSuccess } from '@shared/host-api/contract';
import type { ChatStore } from './chat-core';

/** 拖放/分栏方向：left/right → row 分栏，top/bottom → column 分栏 */
export type PaneEdge = 'left' | 'right' | 'top' | 'bottom';

export type LeafNode = {
  type: 'leaf';
  paneId: string;
  /** 面板目标会话（拖入/点击绑定）。实际绑定以 chat store 的 boundSessionPath 为准，两者由 panes-default 的 watcher 对齐 */
  sessionPath: string | null;
  sessionCwd?: string;
};

export type BranchNode = {
  type: 'split';
  id: string;
  direction: 'row' | 'column';
  /** 第一个子节点占比（0.15–0.85） */
  ratio: number;
  children: [SplitNode, SplitNode];
};

export type SplitNode = LeafNode | BranchNode;

/** 拖入/打开会话的目标描述 */
export type PaneSessionTarget = { sessionPath: string; cwd?: string };

export type PanesDeps = {
  /** 新面板：创建 chat store 实例并注册（web 侧 = createChatStore + registerChatStore） */
  create: (paneId: string) => ChatStore;
  /** 关闭面板：dispose 实例并注销 */
  destroy: (paneId: string) => void;
  /** 按 paneId 取实例（replacePane 复用改绑 / findPaneBySession 读实际绑定） */
  get: (paneId: string) => ChatStore | undefined;
  /** 活跃指针同步到 chat-registry（setActiveChatStoreId） */
  setActive: (paneId: string | null) => void;
};

export type PanesState = {
  root: SplitNode;
  activePaneId: string;
  /** 边缘拖入分栏：新面板按 edge 插入目标面板旁；返回新 paneId（同会话/目标不存在 = null 无操作） */
  splitAt: (paneId: string, edge: PaneEdge, session: PaneSessionTarget) => string | null;
  /** 替换面板会话：复用实例调 switchSession 改绑（dispose 只发生在 closePane）；失败回滚叶子目标 */
  replacePane: (paneId: string, session: PaneSessionTarget) => Promise<HostSuccess> | null;
  /** 关闭面板：兄弟节点上位；根面板不可关 */
  closePane: (paneId: string) => void;
  setRatio: (splitId: string, ratio: number) => void;
  activatePane: (paneId: string) => void;
  /** 会话已打开的面板（叶子目标或实例实际绑定命中）；未打开返回 null */
  findPaneBySession: (sessionPath: string) => string | null;
  /** 已打开 → 激活该面板；否则替换活跃面板会话。返回值供调用方感知失败（搜索跳转等） */
  openOrFocusSession: (sessionPath: string, cwd?: string) => Promise<HostSuccess> | null;
  /** 实例实际绑定变化后回写叶子目标（panes-default 的 watcher 调用） */
  syncPaneSession: (paneId: string, sessionPath: string | null) => void;
};

export const MIN_SPLIT_RATIO = 0.15;
export const MAX_SPLIT_RATIO = 0.85;

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

function findLeaf(node: SplitNode, paneId: string): LeafNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  return findLeaf(node.children[0], paneId) ?? findLeaf(node.children[1], paneId);
}

function leaves(node: SplitNode): LeafNode[] {
  if (node.type === 'leaf') return [node];
  return [...leaves(node.children[0]), ...leaves(node.children[1])];
}

/** 用 replacement 替换目标叶子；paneId 不存在时原样返回 */
function replaceLeaf(node: SplitNode, paneId: string, replacement: SplitNode): SplitNode {
  if (node.type === 'leaf') return node.paneId === paneId ? replacement : node;
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], paneId, replacement),
      replaceLeaf(node.children[1], paneId, replacement),
    ],
  };
}

function updateLeaf(node: SplitNode, paneId: string, patch: Partial<LeafNode>): SplitNode {
  if (node.type === 'leaf') return node.paneId === paneId ? { ...node, ...patch } : node;
  return { ...node, children: [updateLeaf(node.children[0], paneId, patch), updateLeaf(node.children[1], paneId, patch)] };
}

function updateSplit(node: SplitNode, splitId: string, ratio: number): SplitNode {
  if (node.type === 'split') {
    if (node.id === splitId) return { ...node, ratio };
    return { ...node, children: [updateSplit(node.children[0], splitId, ratio), updateSplit(node.children[1], splitId, ratio)] };
  }
  return node;
}

/** 关闭面板：目标叶子的父 split 由其兄弟子树上位；返回新根与上位兄弟（目标是根/不存在 = null） */
function removeLeaf(node: SplitNode, paneId: string): { root: SplitNode; sibling: SplitNode } | null {
  if (node.type === 'leaf') return null; // 根面板不可关
  const [a, b] = node.children;
  if (a.type === 'leaf' && a.paneId === paneId) return { root: b, sibling: b };
  if (b.type === 'leaf' && b.paneId === paneId) return { root: a, sibling: a };
  const nextA = a.type === 'split' ? removeLeaf(a, paneId) : null;
  if (nextA) return { root: { ...node, children: [nextA.root, b] }, sibling: nextA.sibling };
  const nextB = b.type === 'split' ? removeLeaf(b, paneId) : null;
  if (nextB) return { root: { ...node, children: [a, nextB.root] }, sibling: nextB.sibling };
  return null;
}

export type PanesStore = StoreApi<PanesState>;

/** 树中所有叶子的目标会话路径（侧栏"已打开"标记用；实例实际绑定由 watcher 回写叶子） */
export function sessionPathsInTree(node: SplitNode): string[] {
  return leaves(node).flatMap((leaf) => (leaf.sessionPath ? [leaf.sessionPath] : []));
}

export function createPanesStore(deps: PanesDeps, initial: { paneId: string }): PanesStore {
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

  return createStore<PanesState>()((set, get) => {
    const activate = (paneId: string) => {
      if (get().activePaneId === paneId) return;
      set({ activePaneId: paneId });
      deps.setActive(paneId);
    };

    return {
      root: { type: 'leaf', paneId: initial.paneId, sessionPath: null },
      activePaneId: initial.paneId,

      splitAt: (paneId, edge, session) => {
        const { root } = get();
        const target = findLeaf(root, paneId);
        if (!target) return null;
        // 会话已在某面板打开（含目标叶子自身）→ 不复制面板，激活已有面板
        const existing = get().findPaneBySession(session.sessionPath);
        if (existing) {
          activate(existing);
          return null;
        }
        const newPaneId = nextId('pane');
        const store = deps.create(newPaneId);
        const newLeaf: LeafNode = { type: 'leaf', paneId: newPaneId, sessionPath: session.sessionPath, sessionCwd: session.cwd };
        const before = edge === 'left' || edge === 'top';
        const split: BranchNode = {
          type: 'split',
          id: nextId('split'),
          direction: edge === 'left' || edge === 'right' ? 'row' : 'column',
          ratio: 0.5,
          children: before ? [newLeaf, target] : [target, newLeaf],
        };
        set({ root: replaceLeaf(root, paneId, split) });
        activate(newPaneId);
        // 新实例 attach 目标会话（失败留在面板内展示 startError，可重试）
        void store.getState().switchSession(session.sessionPath, session.cwd);
        return newPaneId;
      },

      replacePane: (paneId, session) => {
        const { root } = get();
        const target = findLeaf(root, paneId);
        if (!target) return null;
        if (target.sessionPath === session.sessionPath) {
          activate(paneId);
          return null;
        }
        // 会话已开在别的面板 → 激活那个面板，本面板保持不变（不复制同会话面板）
        const existing = get().findPaneBySession(session.sessionPath);
        if (existing && existing !== paneId) {
          activate(existing);
          return null;
        }
        const previous: PaneSessionTarget | null = target.sessionPath
          ? { sessionPath: target.sessionPath, cwd: target.sessionCwd }
          : null;
        set({ root: updateLeaf(root, paneId, { sessionPath: session.sessionPath, sessionCwd: session.cwd }) });
        activate(paneId);
        const store = deps.get(paneId);
        if (!store) return null;
        // 复用实例改绑；失败回滚叶子目标，避免"已打开"标记指向未绑定的会话
        const result = store.getState().switchSession(session.sessionPath, session.cwd);
        void result.then((r) => {
          if (!r.success && previous) {
            set({ root: updateLeaf(get().root, paneId, { sessionPath: previous.sessionPath, sessionCwd: previous.cwd }) });
          }
        });
        return result;
      },

      closePane: (paneId) => {
        const { root, activePaneId } = get();
        const removed = removeLeaf(root, paneId);
        if (!removed) return;
        set({ root: removed.root });
        deps.destroy(paneId);
        if (activePaneId === paneId) {
          // 活跃面板被关 → 回退到上位兄弟子树的首个叶子
          const next = leaves(removed.sibling)[0];
          if (next) activate(next.paneId);
        }
      },

      setRatio: (splitId, ratio) => {
        set({ root: updateSplit(get().root, splitId, clampRatio(ratio)) });
      },

      activatePane: (paneId) => {
        if (!findLeaf(get().root, paneId)) return;
        activate(paneId);
      },

      findPaneBySession: (sessionPath) => {
        for (const leaf of leaves(get().root)) {
          if (leaf.sessionPath === sessionPath) return leaf.paneId;
          if (deps.get(leaf.paneId)?.getState().boundSessionPath === sessionPath) return leaf.paneId;
        }
        return null;
      },

      openOrFocusSession: (sessionPath, cwd) => {
        const existing = get().findPaneBySession(sessionPath);
        if (existing) {
          get().activatePane(existing);
          return null;
        }
        return get().replacePane(get().activePaneId, { sessionPath, cwd });
      },

      syncPaneSession: (paneId, sessionPath) => {
        const leaf = findLeaf(get().root, paneId);
        if (!leaf || leaf.sessionPath === sessionPath) return;
        set({ root: updateLeaf(get().root, paneId, { sessionPath }) });
      },
    };
  });
}
