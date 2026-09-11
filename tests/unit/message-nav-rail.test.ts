import { describe, expect, it } from 'vitest';
import { buildRailItems, RAIL_FOLD_THRESHOLD, truncateRailText, type RailAnchor } from '../../src/lib/nav-rail';

describe('truncateRailText', () => {
  it('短文本不截断且不加省略号', () => {
    expect(truncateRailText('Hello world')).toBe('Hello world');
    expect(truncateRailText('这是一个简短的问题')).toBe('这是一个简短的问题');
  });

  it('刚好 120 字符不截断', () => {
    const text = 'a'.repeat(120);
    expect(truncateRailText(text)).toBe(text);
  });

  it('超过 120 字符截断并追加省略号', () => {
    const longText = 'a'.repeat(200);
    const truncated = truncateRailText(longText);
    expect(truncated).toBe(`${'a'.repeat(120)}…`);
    expect(Array.from(truncated)).toHaveLength(121);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('中文等多字节 Unicode 字符按字符数正确截断', () => {
    const chineseText = '你'.repeat(150);
    const truncated = truncateRailText(chineseText);
    expect(truncated).toBe(`${'你'.repeat(120)}…`);
    expect(Array.from(truncated)).toHaveLength(121);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('空文本保持为空', () => {
    expect(truncateRailText('')).toBe('');
  });

  it('支持自定义最大长度', () => {
    expect(truncateRailText('abcdef', 3)).toBe('abc…');
  });
});

describe('buildRailItems', () => {
  const makeAnchors = (count: number): RailAnchor[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `anchor-${index}`,
      n: index + 1,
      question: `Question ${index + 1}`,
    }));

  it('keeps every anchor as an anchor item through the fold threshold', () => {
    const anchors = makeAnchors(RAIL_FOLD_THRESHOLD);

    expect(buildRailItems(anchors)).toEqual(
      anchors.map((anchor) => ({ kind: 'anchor', anchor })),
    );
  });

  it('does not fold a 9-anchor rail', () => {
    const anchors = makeAnchors(9);

    expect(buildRailItems(anchors)).toEqual(
      anchors.map((anchor) => ({ kind: 'anchor', anchor })),
    );
  });

  it('does not fold a 10-anchor rail', () => {
    const anchors = makeAnchors(10);

    expect(buildRailItems(anchors)).toEqual(
      anchors.map((anchor) => ({ kind: 'anchor', anchor })),
    );
  });

  it('creates the first folded group at 11 anchors and preserves a complete question', () => {
    const longQuestion = `normalized user content sentinel ${'x'.repeat(180)}`;
    expect(Array.from(longQuestion).length).toBeGreaterThan(120);
    const anchors = makeAnchors(11).map((anchor, index) =>
      index === 5 ? { ...anchor, question: longQuestion } : anchor,
    );

    const items = buildRailItems(anchors);

    expect(items).toHaveLength(5);
    expect(items.slice(0, 2)).toEqual(
      anchors.slice(0, 2).map((anchor) => ({ kind: 'anchor', anchor })),
    );
    expect(items.slice(-2)).toEqual(
      anchors.slice(-2).map((anchor) => ({ kind: 'anchor', anchor })),
    );
    const group = items[2];
    expect(group).toMatchObject({
      kind: 'group',
      id: 'rail-group-anchor-2-anchor-8',
      hiddenCount: 7,
    });
    if (group.kind !== 'group') throw new Error('Expected a folded group');
    expect(group.anchors).toEqual(anchors.slice(2, 9));
    expect(group.anchors[3].question).toBe(longQuestion);
  });

  it('folds only contiguous hidden ranges while protecting the active neighborhood', () => {
    const anchors = makeAnchors(12);

    expect(buildRailItems(anchors, 'anchor-6')).toEqual([
      { kind: 'anchor', anchor: anchors[0] },
      { kind: 'anchor', anchor: anchors[1] },
      {
        kind: 'group',
        id: 'rail-group-anchor-2-anchor-4',
        anchors: anchors.slice(2, 5),
        hiddenCount: 3,
      },
      { kind: 'anchor', anchor: anchors[5] },
      { kind: 'anchor', anchor: anchors[6] },
      { kind: 'anchor', anchor: anchors[7] },
      {
        kind: 'group',
        id: 'rail-group-anchor-8-anchor-9',
        anchors: anchors.slice(8, 10),
        hiddenCount: 2,
      },
      { kind: 'anchor', anchor: anchors[10] },
      { kind: 'anchor', anchor: anchors[11] },
    ]);
  });

  it('uses the first anchor as the protected position when activeId is undefined', () => {
    const anchors = makeAnchors(13);

    expect(buildRailItems(anchors)).toEqual([
      { kind: 'anchor', anchor: anchors[0] },
      { kind: 'anchor', anchor: anchors[1] },
      {
        kind: 'group',
        id: 'rail-group-anchor-2-anchor-10',
        anchors: anchors.slice(2, 11),
        hiddenCount: 9,
      },
      { kind: 'anchor', anchor: anchors[11] },
      { kind: 'anchor', anchor: anchors[12] },
    ]);
  });

  it('protects the active neighborhood when the active anchor is near the head', () => {
    const anchors = makeAnchors(13);

    expect(buildRailItems(anchors, 'anchor-1')).toEqual([
      { kind: 'anchor', anchor: anchors[0] },
      { kind: 'anchor', anchor: anchors[1] },
      { kind: 'anchor', anchor: anchors[2] },
      {
        kind: 'group',
        id: 'rail-group-anchor-3-anchor-10',
        anchors: anchors.slice(3, 11),
        hiddenCount: 8,
      },
      { kind: 'anchor', anchor: anchors[11] },
      { kind: 'anchor', anchor: anchors[12] },
    ]);
  });

  it('protects the active neighborhood when the active anchor is near the tail', () => {
    const anchors = makeAnchors(13);

    expect(buildRailItems(anchors, 'anchor-11')).toEqual([
      { kind: 'anchor', anchor: anchors[0] },
      { kind: 'anchor', anchor: anchors[1] },
      {
        kind: 'group',
        id: 'rail-group-anchor-2-anchor-9',
        anchors: anchors.slice(2, 10),
        hiddenCount: 8,
      },
      { kind: 'anchor', anchor: anchors[10] },
      { kind: 'anchor', anchor: anchors[11] },
      { kind: 'anchor', anchor: anchors[12] },
    ]);
  });

  it('uses the first anchor neighborhood when activeId does not exist', () => {
    const anchors = makeAnchors(13);

    expect(buildRailItems(anchors, 'missing-anchor')).toEqual(buildRailItems(anchors));
  });

  it('gives each hidden group a stable id derived from its original anchors', () => {
    const anchors = makeAnchors(13);
    const firstBuild = buildRailItems(anchors, 'anchor-6');
    const secondBuild = buildRailItems([...anchors], 'anchor-6');

    const firstGroups = firstBuild.filter((item) => item.kind === 'group');
    const secondGroups = secondBuild.filter((item) => item.kind === 'group');

    expect(firstGroups).toHaveLength(2);
    expect(secondGroups.map((group) => group.id)).toEqual(firstGroups.map((group) => group.id));
    expect(firstGroups.map((group) => group.anchors.map((anchor) => anchor.id))).toEqual([
      ['anchor-2', 'anchor-3', 'anchor-4'],
      ['anchor-8', 'anchor-9', 'anchor-10'],
    ]);
    expect(firstGroups.map((group) => group.hiddenCount)).toEqual([3, 3]);
  });
});
