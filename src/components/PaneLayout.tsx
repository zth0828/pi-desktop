// 分栏布局：递归渲染 panes 二叉分栏树，
// split 节点 = flex 容器 + 可拖分隔条（pointer capture 拖 ratio，store 内 clamp 15%–85%），
// 叶子 = ChatStoreProvider + ChatPane + 会话拖入落区（5 区：四边分栏 / 中心替换）。
// ?session= attach / workspaceCwd 恢复只作用于窗口首个面板（primary = DEFAULT_CHAT_STORE_ID），
// 在本文件顶层读取一次后下传，避免每个新面板挂载都跑一遍恢复逻辑。
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { markSessionDroppedInWindow, setPaneDropHoverActive } from '../lib/session-drag';
import { getChatStore } from '../stores/chat-registry';
import { DEFAULT_CHAT_STORE_ID } from '../stores/default-chat-store';
import { sessionPathsInTree, type BranchNode, type LeafNode, type SplitNode } from '../stores/panes';
import { panesStore } from '../stores/panes-default';
import { ChatPane } from '../pages/Chat';
import { ChatStoreProvider, useActiveChatStore } from '../pages/Chat/chat-store-context';

const SESSION_MIME = 'application/x-pi-session';

export type PaneLayoutProps = {
  searchTarget?: { sessionId: string; messageIndex: number; nonce: number };
  onSearchTargetHandled?: () => void;
};

/** 落区判定：面板边缘约 25% 区域为四边分栏区，其余为中心替换区 */
type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

const DROP_HINT_KEYS: Record<DropZone, string> = {
  left: 'panes.dropSplitLeft',
  right: 'panes.dropSplitRight',
  top: 'panes.dropSplitTop',
  bottom: 'panes.dropSplitBottom',
  center: 'panes.dropReplace',
};

function zoneFromPoint(event: DragEvent<HTMLDivElement>): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  if (x < 0.25) return 'left';
  if (x > 0.75) return 'right';
  if (y < 0.25) return 'top';
  if (y > 0.75) return 'bottom';
  return 'center';
}

function countLeaves(node: SplitNode): number {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

type SharedProps = PaneLayoutProps & {
  leafCount: number;
  attachSession: string | null;
};

function PaneLeaf({ node, shared }: { node: LeafNode; shared: SharedProps }) {
  const { t } = useTranslation();
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const isActive = useStore(panesStore, (s) => s.activePaneId === node.paneId);
  const store = getChatStore(node.paneId);
  // 落区激活状态同步给 SessionList 的全局拖拽提示（hover 落区时提示弱化让位）
  useEffect(() => {
    setPaneDropHoverActive(dropZone !== null);
    return () => setPaneDropHoverActive(false);
  }, [dropZone]);
  if (!store) return null; // closePane 瞬态：实例已销毁、树尚未重渲染
  const primary = node.paneId === DEFAULT_CHAT_STORE_ID;
  const closable = shared.leafCount > 1;

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(SESSION_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropZone(zoneFromPoint(event));
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropZone(null);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropZone(null);
    const raw = event.dataTransfer.getData(SESSION_MIME);
    if (!raw) return;
    event.preventDefault();
    try {
      const payload = JSON.parse(raw) as { sessionPath: string; cwd?: string };
      if (!payload.sessionPath) return;
      const zone = zoneFromPoint(event);
      const applyDrop = () => {
        const panes = panesStore.getState();
        // 边缘 → 分栏；中心 → 替换（同窗口内同会话由 store 降级为激活）
        if (zone === 'center') panes.replacePane(node.paneId, payload);
        else panes.splitAt(node.paneId, zone, payload);
      };
      // 先让 main 侧检查其他窗口，保证会话全局只归一个窗口；未打开时再执行本窗口分栏。
      void hostApi.windows.focusIfOpen(payload.sessionPath)
        .then((focused) => { if (!focused) applyDrop(); })
        .catch(applyDrop);
      // 窗口内已消化：抑制 SessionList dragend 的 OS 级 openDetachedAt
      markSessionDroppedInWindow();
    } catch {
      // 非法 payload 按未处理落回（dragend 仍会上报 OS 开窗判定）
    }
  };

  return (
    <div
      className="pane-leaf"
      data-testid={`pane-leaf-${node.paneId}`}
      data-active={isActive || undefined}
      onPointerDownCapture={() => panesStore.getState().activatePane(node.paneId)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ChatStoreProvider store={store}>
        <ChatPane
          primary={primary}
          attachSession={primary ? shared.attachSession : null}
          attachTarget={node.sessionPath ? { sessionPath: node.sessionPath, cwd: node.sessionCwd } : null}
          onClosePane={closable ? () => panesStore.getState().closePane(node.paneId) : undefined}
          searchTarget={isActive ? shared.searchTarget : undefined}
          onSearchTargetHandled={shared.onSearchTargetHandled}
        />
      </ChatStoreProvider>
      {dropZone && (
        <div className="pane-drop-overlay" data-testid="pane-drop-overlay">
          <div className={`pane-drop-highlight zone-${dropZone}`} data-testid="pane-drop-highlight" />
          <div className="pane-drop-label" data-testid="pane-drop-label">
            {t(DROP_HINT_KEYS[dropZone])}
          </div>
        </div>
      )}
    </div>
  );
}

function PaneDivider({ node }: { node: BranchNode }) {
  const setRatio = useStore(panesStore, (s) => s.setRatio);
  return (
    <div
      className={`pane-divider ${node.direction === 'row' ? 'vertical' : 'horizontal'}`}
      data-testid="pane-divider"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const container = event.currentTarget.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const ratio = node.direction === 'row'
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height;
        setRatio(node.id, ratio);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    />
  );
}

function PaneNode({ node, shared }: { node: SplitNode; shared: SharedProps }) {
  if (node.type === 'leaf') return <PaneLeaf node={node} shared={shared} />;
  return (
    <div className={`pane-split pane-split-${node.direction}`}>
      <div className="pane-split-child" style={{ flexGrow: node.ratio }}>
        <PaneNode node={node.children[0]} shared={shared} />
      </div>
      <PaneDivider node={node} />
      <div className="pane-split-child" style={{ flexGrow: 1 - node.ratio }}>
        <PaneNode node={node.children[1]} shared={shared} />
      </div>
    </div>
  );
}

export function PaneLayout(props: PaneLayoutProps) {
  const root = useStore(panesStore, (s) => s.root);
  const activeSessionPath = useActiveChatStore((s) => s.boundSessionPath);
  // 独立会话窗口：?session=<path> 由 main 侧建窗时带上；dev 是 URL
  // searchParams，prod 是 loadFile query。只在窗口顶层读一次，下传给首个面板。
  const [attachSession] = useState(() => new URLSearchParams(window.location.search).get('session'));
  const leafCount = useMemo(() => countLeaves(root), [root]);
  const sessionPaths = useMemo(() => {
    const paths = sessionPathsInTree(root);
    // detached 窗口首帧的 pane 尚未完成 attach，保留建窗时的 URL 会话占用，
    // 防止这段 IPC 竞态期间另一窗口再次创建同一会话。
    return paths.length > 0 || !attachSession ? paths : [attachSession];
  }, [attachSession, root]);
  useEffect(() => {
    void hostApi.windows.setSessions({
      sessionPaths,
      activeSessionPath: activeSessionPath ?? undefined,
    });
  }, [activeSessionPath, sessionPaths]);
  useEffect(() => onHostEvent('windows', 'focusSession', ({ sessionPath }) => {
    panesStore.getState().openOrFocusSession(sessionPath);
  }), []);
  const shared: SharedProps = { ...props, leafCount, attachSession };
  return (
    <div className="pane-layout" data-testid="pane-layout">
      <PaneNode node={root} shared={shared} />
    </div>
  );
}
