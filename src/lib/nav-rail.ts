/** Maximum number of message anchors rendered without folding. */
export const RAIL_FOLD_THRESHOLD = 10;

export type RailAnchor = {
  /** 对应消息的稳定 DOM id。 */
  id: string;
  /** 在同类锚点中的序号（1 起）。 */
  n: number;
  /** 完整、规范化后的用户发送内容；展示层再做预览截断。 */
  question: string;
};

export type RailItem =
  | {
      kind: 'anchor';
      anchor: RailAnchor;
    }
  | {
      kind: 'group';
      /** Stable id derived from the first and last hidden anchors. */
      id: string;
      /** Hidden anchors in their original order. */
      anchors: RailAnchor[];
      hiddenCount: number;
    };

/**
 * Build the compact representation of a message navigation rail.
 *
 * Short rails keep every anchor. Longer rails protect the ends and the active
 * anchor's immediate neighborhood, replacing each remaining contiguous range
 * with one group item.
 */
export function buildRailItems(anchors: RailAnchor[], activeId?: string): RailItem[] {
  if (anchors.length <= RAIL_FOLD_THRESHOLD) {
    return anchors.map((anchor) => ({ kind: 'anchor', anchor }));
  }

  const activeIndex = Math.max(
    0,
    anchors.findIndex((anchor) => anchor.id === activeId),
  );
  const protectedIndexes = new Set<number>([0, 1, anchors.length - 2, anchors.length - 1]);
  for (
    let index = Math.max(0, activeIndex - 1);
    index <= Math.min(anchors.length - 1, activeIndex + 1);
    index += 1
  ) {
    protectedIndexes.add(index);
  }

  const items: RailItem[] = [];
  let index = 0;
  while (index < anchors.length) {
    if (protectedIndexes.has(index)) {
      items.push({ kind: 'anchor', anchor: anchors[index] });
      index += 1;
      continue;
    }

    const start = index;
    while (index < anchors.length && !protectedIndexes.has(index)) index += 1;
    const hiddenAnchors = anchors.slice(start, index);
    items.push({
      kind: 'group',
      id: `rail-group-${hiddenAnchors[0].id}-${hiddenAnchors[hiddenAnchors.length - 1].id}`,
      anchors: hiddenAnchors,
      hiddenCount: hiddenAnchors.length,
    });
  }

  return items;
}

/**
 * 导航 rail 悬浮提示文本截断，避免长文本撑高/撑宽浮层遮挡内容。
 */
export function truncateRailText(text: string, max = 120): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
