// 用户消息导航 rail：长会话时消息列表右侧悬浮一列圆点（每条 user 消息一个点）。
// 点击平滑滚动到对应消息；当前可视区域附近的点高亮。
import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

export type RailAnchor = {
  /** 对应 user 消息的 DOM id（稳定锚点，chat-msg-<index>） */
  id: string;
  /** 在 user 消息中的序号（1 起，aria-label 用） */
  n: number;
};

type Props = {
  anchors: RailAnchor[];
  /** 消息列表滚动容器 */
  listRef: RefObject<HTMLDivElement | null>;
};

export function MessageNavRail({ anchors, listRef }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>();

  useEffect(() => {
    const list = listRef.current;
    if (!list || anchors.length === 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      // 滚到底部时高亮最后一条（TOC 语义：底部没有更多内容越过读线）
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 2) {
        setActiveId(anchors[anchors.length - 1]?.id);
        return;
      }
      const listTop = list.getBoundingClientRect().top;
      // 视口上沿往下 35% 为界：最后一个越过界线的 user 消息即"当前"
      let current: string | undefined;
      for (const anchor of anchors) {
        const el = document.getElementById(anchor.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - listTop <= list.clientHeight * 0.35) {
          current = anchor.id;
        }
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

  if (anchors.length < 2) return null;

  return (
    <div className="msg-rail" data-testid="msg-rail">
      {anchors.map((anchor) => (
        <button
          key={anchor.id}
          className={activeId === anchor.id ? 'msg-rail-dot active' : 'msg-rail-dot'}
          data-testid={`msg-rail-dot-${anchor.id}`}
          aria-label={t('rail.jumpTo', { index: anchor.n })}
          onClick={() =>
            document
              .getElementById(anchor.id)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        />
      ))}
    </div>
  );
}
