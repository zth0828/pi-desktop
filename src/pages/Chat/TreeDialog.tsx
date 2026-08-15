import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiRuntimeTreeNode } from '@shared/host-api/contract';
import { usePaneChatStore, usePaneHostApi } from './chat-store-context';

/** 会话分支树面板（/tree）：列出当前会话文件里的分支节点，点击跳转 navigateTree。 */
export function TreeDialog() {
  const { t } = useTranslation();
  const open = usePaneChatStore((s) => s.treeOpen);
  const setTreeOpen = usePaneChatStore((s) => s.setTreeOpen);
  const navigateTo = usePaneChatStore((s) => s.navigateTo);
  const paneApi = usePaneHostApi();
  const [nodes, setNodes] = useState<PiRuntimeTreeNode[]>([]);

  useEffect(() => {
    if (!open) return;
    void paneApi.piRuntime
      .getTree()
      .then((r) => setNodes(r.nodes))
      .catch(() => setNodes([]));
  }, [open, paneApi]);

  if (!open) return null;
  return (
    <div className="tree-overlay" data-testid="tree-dialog" onClick={() => setTreeOpen(false)}>
      <div className="tree-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tree-title">{t('chat.tree.title')}</div>
        <div className="tree-list">
          {nodes.length === 0 && <div className="tree-empty">{t('chat.tree.empty')}</div>}
          {nodes.map((n) => (
            <button
              key={n.id}
              className={`tree-node${n.onCurrentPath ? ' on-path' : ''}${n.isLeaf ? ' is-leaf' : ''}`}
              data-testid="tree-node"
              data-kind={n.kind}
              style={{ paddingLeft: 10 + n.depth * 18 }}
              disabled={n.isLeaf}
              onClick={() => {
                setTreeOpen(false);
                void navigateTo(n.id);
              }}
            >
              <span className={`tree-node-kind kind-${n.kind}`}>{t(`chat.tree.kind.${n.kind}`)}</span>
              <span className="tree-node-text">{n.text || '—'}</span>
              {n.label && <span className="tree-node-label">{n.label}</span>}
              {n.isLeaf && <span className="tree-node-leaf">{t('chat.tree.current')}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
