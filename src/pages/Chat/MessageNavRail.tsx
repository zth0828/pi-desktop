// 消息导航 rail：普通 user 消息与上下文压缩检查点使用两套独立锚点。
// 跳转由父级通过 onJumpTo 负责；本组件只负责渲染与 active 状态计算。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { buildRailItems, truncateRailText, type RailAnchor } from '../../lib/nav-rail';

export { truncateRailText };
export type { RailAnchor };

export type CompactionRailAnchor = {
  id: string;
  n: number;
  summary: string;
};

type Props = {
  anchors: RailAnchor[];
  compactionAnchors?: CompactionRailAnchor[];
  /** 消息列表滚动容器，仅用于计算当前 active 锚点。 */
  listRef: RefObject<HTMLDivElement | null>;
  /** 由父级执行消息定位。 */
  onJumpTo: (anchorId: string) => void;
  /** 回底部恢复普通 rail 状态，不耦合压缩 rail 的 active。 */
  returnToBottomVersion?: number;
};

function useActiveAnchor<T extends { id: string }>(anchors: T[], listRef: Props['listRef'], refreshVersion = 0): string | undefined {
  const [activeId, setActiveId] = useState<string>();

  useEffect(() => {
    const list = listRef.current;
    if (!list || anchors.length === 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 24) {
        setActiveId(anchors[anchors.length - 1]?.id);
        return;
      }
      const listTop = list.getBoundingClientRect().top;
      let current: string | undefined;
      for (const anchor of anchors) {
        const el = list.querySelector<HTMLElement>(`[id="${anchor.id}"]`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - listTop <= list.clientHeight * 0.35) current = anchor.id;
      }
      setActiveId(current ?? anchors[0]?.id);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      list.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [anchors, listRef, refreshVersion]);

  return activeId;
}

const GROUP_COLLAPSE_DELAY_MS = 180;

export function MessageNavRail({ anchors, compactionAnchors = [], listRef, onJumpTo, returnToBottomVersion = 0 }: Props) {
  const { t } = useTranslation();
  const activeId = useActiveAnchor(anchors, listRef, returnToBottomVersion);
  const activeCompactionId = useActiveAnchor(compactionAnchors, listRef);
  const railRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeReadyRef = useRef(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const closeGroup = useCallback(() => {
    clearCollapseTimer();
    setOpenGroupId(null);
  }, [clearCollapseTimer]);

  const scheduleGroupClose = useCallback(() => {
    clearCollapseTimer();
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      setOpenGroupId(null);
    }, GROUP_COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer]);

  // 初始 active 计算可能在 mount 后才完成；等这一帧后再把 active 变化视为收起信号，
  // 避免点击刚展开的组时被初始测量立刻关闭。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      activeReadyRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!activeReadyRef.current) return;
    closeGroup();
  }, [activeId, closeGroup]);

  const anchorSignature = anchors
    .map((anchor) => `${anchor.id}:${anchor.n}:${anchor.question}`)
    .join('\u0000');
  const compactionSignature = compactionAnchors
    .map((anchor) => `${anchor.id}:${anchor.n}:${anchor.summary}`)
    .join('\u0000');

  useEffect(() => {
    closeGroup();
  }, [anchorSignature, compactionSignature, returnToBottomVersion, closeGroup]);

  useEffect(() => {
    return clearCollapseTimer;
  }, [clearCollapseTimer]);

  useEffect(() => {
    if (openGroupId === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target && railRef.current?.contains(event.target as Node)) return;
      closeGroup();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeGroup();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeGroup, openGroupId]);

  const railItems = buildRailItems(anchors, activeId);
  if (anchors.length < 2 && compactionAnchors.length === 0) return null;

  return (
    <>
      {anchors.length >= 2 && (
        <div
          ref={railRef}
          className="msg-rail"
          data-testid="msg-rail"
          aria-label={t('rail.messages')}
          onPointerEnter={clearCollapseTimer}
        >
          {railItems.map((item) => {
            if (item.kind === 'anchor') {
              const { anchor } = item;
              const question = anchor.question || t('rail.attachmentQuestion');
              return (
                <button
                  key={anchor.id}
                  type="button"
                  className={activeId === anchor.id ? 'msg-rail-dot active' : 'msg-rail-dot'}
                  data-testid={`msg-rail-dot-${anchor.id}`}
                  aria-label={t('rail.jumpToMessage', { question })}
                  title={question}
                  onClick={() => onJumpTo(anchor.id)}
                >
                  <span className="msg-rail-tooltip" data-testid="msg-rail-tooltip">
                    {truncateRailText(question)}
                  </span>
                </button>
              );
            }

            const isOpen = openGroupId === item.id;
            const containsActive = item.anchors.some((anchor) => anchor.id === activeId);
            const panelId = `${item.id}-panel`;
            return (
              <div
                key={item.id}
                className="msg-rail-group"
                data-active={containsActive ? 'true' : undefined}
                onPointerEnter={clearCollapseTimer}
                onPointerLeave={scheduleGroupClose}
              >
                <button
                  type="button"
                  className={containsActive ? 'msg-rail-group-dot active' : 'msg-rail-group-dot'}
                  id={`msg-rail-group-${item.id}`}
                  data-testid="msg-rail-group"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  aria-label={t(isOpen ? 'rail.collapseGroup' : 'rail.expandGroup', {
                    count: item.hiddenCount,
                  })}
                  title={t('rail.hiddenMessages', { count: item.hiddenCount })}
                  onClick={() => {
                    clearCollapseTimer();
                    setOpenGroupId((current) => (current === item.id ? null : item.id));
                  }}
                >
                  <span className="msg-rail-group-mark" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </button>
                {isOpen && (
                  <div
                    id={panelId}
                    className="msg-rail-group-panel"
                    data-testid="msg-rail-group-panel"
                    role="region"
                    aria-labelledby={`msg-rail-group-${item.id}`}
                    onPointerEnter={clearCollapseTimer}
                    onPointerLeave={scheduleGroupClose}
                  >
                    {item.anchors.map((anchor) => {
                      const question = anchor.question || t('rail.attachmentQuestion');
                      return (
                        <button
                          key={anchor.id}
                          type="button"
                          className={anchor.id === activeId ? 'msg-rail-group-row active' : 'msg-rail-group-row'}
                          data-testid={`msg-rail-group-row-${anchor.id}`}
                          aria-label={t('rail.jumpToMessage', { question })}
                          title={question}
                          onClick={() => {
                            closeGroup();
                            onJumpTo(anchor.id);
                          }}
                        >
                          <span className="msg-rail-group-row-text" title={question}>
                            {question}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {compactionAnchors.length > 0 && (
        <div className="compaction-rail" data-testid="compaction-rail" aria-label={t('rail.compactions')}>
          {compactionAnchors.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              className={activeCompactionId === anchor.id ? 'compaction-rail-dot active' : 'compaction-rail-dot'}
              data-testid={`compaction-rail-dot-${anchor.id}`}
              aria-label={t('rail.jumpToCompaction', { index: anchor.n })}
              onClick={() => onJumpTo(anchor.id)}
            >
              <span className="msg-rail-tooltip" data-testid="compaction-rail-tooltip">
                {anchor.summary || t('rail.compaction')}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
