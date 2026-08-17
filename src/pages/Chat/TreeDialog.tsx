import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiRuntimeTreeNode } from '@shared/host-api/contract';
import { usePaneChatStore, usePaneHostApi } from './chat-store-context';

type Step =
  | { kind: 'list' }
  | { kind: 'choice'; targetId: string }
  | { kind: 'custom'; targetId: string }
  | { kind: 'summarizing' };

/** 会话分支树面板（/tree）：列出当前会话文件里的分支节点，点击跳转 navigateTree。 */
export function TreeDialog() {
  const { t } = useTranslation();
  const open = usePaneChatStore((s) => s.treeOpen);
  const setTreeOpen = usePaneChatStore((s) => s.setTreeOpen);
  const navigateTo = usePaneChatStore((s) => s.navigateTo);
  const abort = usePaneChatStore((s) => s.abort);
  const skipSummaryPrompt = usePaneChatStore((s) => s.branchSummarySkipPrompt);
  const paneApi = usePaneHostApi();
  const [nodes, setNodes] = useState<PiRuntimeTreeNode[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [customText, setCustomText] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep({ kind: 'list' });
    setCustomText('');
    void paneApi.piRuntime
      .getTree()
      .then((r) => setNodes(r.nodes))
      .catch(() => setNodes([]));
  }, [open, paneApi]);

  if (!open) return null;

  // TUI 跳分支语义：skipPrompt 时直接跳（不摘要）；否则先问是否摘要被弃分支
  const go = async (targetId: string, options?: { summarize?: boolean; customInstructions?: string }) => {
    if (options?.summarize) setStep({ kind: 'summarizing' });
    else setTreeOpen(false);
    const result = await navigateTo(targetId, options);
    if (result.success) setTreeOpen(false);
    // 摘要被打断/失败：回到列表重选（TUI 中断后重开分支树）
    else setStep({ kind: 'list' });
  };

  const pick = (targetId: string) => {
    if (skipSummaryPrompt) void go(targetId);
    else setStep({ kind: 'choice', targetId });
  };

  return (
    <div className="tree-overlay" data-testid="tree-dialog" onClick={() => step.kind !== 'summarizing' && setTreeOpen(false)}>
      <div className="tree-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tree-title">{t('chat.tree.title')}</div>
        {step.kind === 'list' && (
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
                onClick={() => pick(n.id)}
              >
                <span className={`tree-node-kind kind-${n.kind}`}>{t(`chat.tree.kind.${n.kind}`)}</span>
                <span className="tree-node-text">{n.text || '—'}</span>
                {n.label && <span className="tree-node-label">{n.label}</span>}
                {n.isLeaf && <span className="tree-node-leaf">{t('chat.tree.current')}</span>}
              </button>
            ))}
          </div>
        )}
        {step.kind === 'choice' && (
          <div className="tree-summary-choice" data-testid="tree-summary-choice">
            <div className="tree-summary-question">{t('chat.tree.summarizeQuestion')}</div>
            <div className="tree-summary-options">
              <button className="extui-option" data-testid="tree-summary-no" onClick={() => void go(step.targetId)}>
                {t('chat.tree.summaryNo')}
              </button>
              <button className="extui-option" data-testid="tree-summary-yes" onClick={() => void go(step.targetId, { summarize: true })}>
                {t('chat.tree.summaryYes')}
              </button>
              <button className="extui-option" data-testid="tree-summary-custom" onClick={() => setStep({ kind: 'custom', targetId: step.targetId })}>
                {t('chat.tree.summaryCustom')}
              </button>
            </div>
          </div>
        )}
        {step.kind === 'custom' && (
          <div className="tree-summary-choice" data-testid="tree-summary-custom-form">
            <div className="tree-summary-question">{t('chat.tree.summaryCustomPrompt')}</div>
            <textarea
              className="extui-editor"
              data-testid="tree-summary-custom-input"
              value={customText}
              autoFocus
              onChange={(e) => setCustomText(e.target.value)}
            />
            <div className="extui-footer">
              <button className="btn" data-testid="tree-summary-custom-back" onClick={() => setStep({ kind: 'choice', targetId: step.targetId })}>
                {t('extui.cancel')}
              </button>
              <button
                className="btn primary"
                data-testid="tree-summary-custom-go"
                disabled={!customText.trim()}
                onClick={() => void go(step.targetId, { summarize: true, customInstructions: customText.trim() })}
              >
                {t('extui.ok')}
              </button>
            </div>
          </div>
        )}
        {step.kind === 'summarizing' && (
          <div className="tree-summary-choice" data-testid="tree-summarizing">
            <div className="tree-summary-question">{t('chat.tree.summarizing')}</div>
            <div className="extui-footer">
              <button
                className="btn"
                data-testid="tree-summary-abort"
                onClick={() => void abort()}
              >
                {t('extui.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
