// 消息导航 rail：普通 user 消息与上下文压缩检查点使用两套独立锚点。
// 所有跳转只滚动消息列表，不调用 scrollIntoView，避免带动外层 content。
import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

export type RailAnchor = {
  /** 对应消息的稳定 DOM id。 */
  id: string;
  /** 在同类锚点中的序号（1 起）。 */
  n: number;
  /** 悬浮预览文本。 */
  question: string;
};

export type CompactionRailAnchor = {
  id: string;
  n: number;
  summary: string;
};

type Props = {
  anchors: RailAnchor[];
  compactionAnchors?: CompactionRailAnchor[];
  /** 消息列表滚动容器。 */
  listRef: RefObject<HTMLDivElement | null>;
};

function useActiveAnchor<T extends { id: string }>(anchors: T[], listRef: Props['listRef']): string | undefined {
  const [activeId, setActiveId] = useState<string>();

  useEffect(() => {
    const list = listRef.current;
    if (!list || anchors.length === 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 2) {
        setActiveId(anchors[anchors.length - 1]?.id);
        return;
      }
      const listTop = list.getBoundingClientRect().top;
      let current: string | undefined;
      for (const anchor of anchors) {
        const el = document.getElementById(anchor.id);
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
  }, [anchors, listRef]);

  return activeId;
}

function jumpTo(anchorId: string, listRef: Props['listRef']): void {
  const list = listRef.current;
  const target = document.getElementById(anchorId);
  if (!list || !target) return;
  const listRect = list.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  list.scrollTo({
    top: Math.max(0, list.scrollTop + targetRect.top - listRect.top - 20),
    behavior: 'smooth',
  });
}

export function MessageNavRail({ anchors, compactionAnchors = [], listRef }: Props) {
  const { t } = useTranslation();
  const activeId = useActiveAnchor(anchors, listRef);
  const activeCompactionId = useActiveAnchor(compactionAnchors, listRef);
  if (anchors.length < 2 && compactionAnchors.length === 0) return null;

  return (
    <>
      {anchors.length >= 2 && (
        <div className="msg-rail" data-testid="msg-rail" aria-label={t('rail.messages')}>
          {anchors.map((anchor) => (
            <button
              key={anchor.id}
              className={activeId === anchor.id ? 'msg-rail-dot active' : 'msg-rail-dot'}
              data-testid={`msg-rail-dot-${anchor.id}`}
              aria-label={t('rail.jumpTo', { index: anchor.n })}
              onClick={() => jumpTo(anchor.id, listRef)}
            >
              <span className="msg-rail-tooltip" data-testid="msg-rail-tooltip">
                {anchor.question || t('rail.attachmentQuestion')}
              </span>
            </button>
          ))}
        </div>
      )}
      {compactionAnchors.length > 0 && (
        <div className="compaction-rail" data-testid="compaction-rail" aria-label={t('rail.compactions')}>
          {compactionAnchors.map((anchor) => (
            <button
              key={anchor.id}
              className={activeCompactionId === anchor.id ? 'compaction-rail-dot active' : 'compaction-rail-dot'}
              data-testid={`compaction-rail-dot-${anchor.id}`}
              aria-label={t('rail.jumpToCompaction', { index: anchor.n })}
              onClick={() => jumpTo(anchor.id, listRef)}
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
