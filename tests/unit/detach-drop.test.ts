// detach-drop（多窗口 M3）：拖出落点的 bounds 判定与居中 clamp 纯函数。
import { describe, expect, it } from 'vitest';
import { centerBoundsAtPoint, isPointInsideRects } from '@electron/utils/detach-drop';

describe('isPointInsideRects', () => {
  const rects = [
    { x: 0, y: 0, width: 1280, height: 800 },
    { x: 1440, y: 100, width: 800, height: 600 },
  ];

  it('落点在任一矩形内 → true', () => {
    expect(isPointInsideRects({ x: 10, y: 10 }, rects)).toBe(true);
    expect(isPointInsideRects({ x: 1500, y: 200 }, rects)).toBe(true);
  });

  it('左/上边界算在内，右/下边界不算', () => {
    expect(isPointInsideRects({ x: 0, y: 0 }, rects)).toBe(true);
    expect(isPointInsideRects({ x: 1280, y: 400 }, rects)).toBe(false);
    expect(isPointInsideRects({ x: 640, y: 800 }, rects)).toBe(false);
  });

  it('所有矩形之外 → false；空列表 → false', () => {
    expect(isPointInsideRects({ x: 1300, y: 50 }, rects)).toBe(false);
    expect(isPointInsideRects({ x: -5, y: -5 }, rects)).toBe(false);
    expect(isPointInsideRects({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('centerBoundsAtPoint', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  const size = { width: 960, height: 640 };

  it('落点居中：bounds 中心即落点', () => {
    expect(centerBoundsAtPoint({ x: 720, y: 450 }, size, workArea)).toEqual({
      x: 240,
      y: 130,
      width: 960,
      height: 640,
    });
  });

  it('靠近左上边缘时 clamp 到 workArea 左上', () => {
    expect(centerBoundsAtPoint({ x: 5, y: 30 }, size, workArea)).toEqual({
      x: 0,
      y: 25,
      width: 960,
      height: 640,
    });
  });

  it('靠近右下边缘时 clamp 到 workArea 右下', () => {
    expect(centerBoundsAtPoint({ x: 1430, y: 890 }, size, workArea)).toEqual({
      x: 480,
      y: 260,
      width: 960,
      height: 640,
    });
  });

  it('非零 workArea 原点（副屏）同样 clamp 正确', () => {
    const sideArea = { x: 1440, y: 0, width: 800, height: 600 };
    expect(centerBoundsAtPoint({ x: 1800, y: 10 }, size, sideArea)).toEqual({
      x: 1440,
      y: 0,
      width: 960,
      height: 640,
    });
  });
});
