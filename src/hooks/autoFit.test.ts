/**
 * TickBar — 主窗自适应尺寸的纯函数用例（T15）
 * -----------------------------------------------------------------------------
 * 这些用例钉的是「窗口贴不贴内容」的观感问题，每一条都对应一个踩过的坑：
 * 遮罩把窗口撑满屏、stack 的留白留在窗口里、负偏移不裁剪、1px 抖动抽搐。
 * 纯函数层不碰 DOM / Tauri，所以跑得很快（jsdom 下毫秒级）。
 *
 * [ADR-020] 入参从「画布尺寸」换成「布局上界」：主窗 = 显示器工作区，语义没变，
 * 只是一墙之隔的常量不再写死。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIT_THRESHOLDS,
  computeFitBox,
  isRendered,
  toLayerRect,
  unionEdges,
  type Edges,
  type FitBox,
} from '../lib/autoFit';

/** 一块 1440×900 的工作区（DIP）——典型 1080p 屏去掉任务栏后的逻辑尺寸 */
const BOUNDS = { w: 1440, h: 900 };
const FIRST: FitBox = { l: 0, t: 0, w: 0, h: 0 };
const PAD = DEFAULT_FIT_THRESHOLDS.pad;

/** 造一块布局坐标矩形 */
function box(left: number, top: number, width: number, height: number): Edges {
  return { left, top, right: left + width, bottom: top + height };
}

describe('isRendered — 悬空/不可见元素必须被跳过', () => {
  it('display:none / visibility:hidden / opacity:0 一律不算内容', () => {
    expect(isRendered({ display: 'none' }, { width: 10, height: 10 })).toBe(false);
    expect(isRendered({ visibility: 'hidden' }, { width: 10, height: 10 })).toBe(false);
    expect(isRendered({ opacity: '0' }, { width: 10, height: 10 })).toBe(false);
  });

  it('opacity 极低（<=0.01，淡出动画尾帧）也算不可见', () => {
    expect(isRendered({ opacity: '0.01' }, { width: 10, height: 10 })).toBe(false);
    expect(isRendered({ opacity: '0.011' }, { width: 10, height: 10 })).toBe(true);
  });

  it('0×0 的幽灵节点必须剔除：它会把 left/top 拉到 0，窗口被撑满屏', () => {
    expect(isRendered({}, { width: 0, height: 10 })).toBe(false);
    expect(isRendered({}, { width: 10, height: 0 })).toBe(false);
  });

  it('缺省 opacity 视为 1（getComputedStyle 的空串不该被当成 0）', () => {
    expect(isRendered({}, { width: 1, height: 1 })).toBe(true);
    expect(isRendered({ opacity: '' }, { width: 1, height: 1 })).toBe(true);
  });
});

describe('unionEdges — 多块矩形取并集', () => {
  it('空集合返回 null（这一轮什么都不做）', () => {
    expect(unionEdges([])).toBeNull();
  });

  it('单块原样返回', () => {
    expect(unionEdges([box(16, 16, 178, 32)])).toEqual({
      left: 16,
      top: 16,
      right: 194,
      bottom: 48,
    });
  });

  it('两块错开的矩形取外包（小条 + 下方展开的面板）', () => {
    const u = unionEdges([box(16, 16, 178, 32), box(16, 48, 320, 200)]);
    expect(u).toEqual({ left: 16, top: 16, right: 336, bottom: 248 });
  });

  it('退化矩形（宽或高为 0）不参与，且不会把 left 压到 0', () => {
    const u = unionEdges([box(100, 100, 0, 40), box(100, 100, 40, 0), box(16, 16, 178, 32)]);
    expect(u).toEqual({ left: 16, top: 16, right: 194, bottom: 48 });
  });

  it('NaN / Infinity 被丢弃而不是污染结果', () => {
    const bad: Edges = {
      left: Number.NaN,
      top: 0,
      right: Number.POSITIVE_INFINITY,
      bottom: 10,
    };
    expect(unionEdges([bad, box(16, 16, 178, 32)])).toEqual({
      left: 16,
      top: 16,
      right: 194,
      bottom: 48,
    });
  });

  it('完全落在原点之外（right/bottom <= 0）返回 null', () => {
    expect(unionEdges([box(-100, -100, 50, 50)])).toBeNull();
  });
});

describe('computeFitBox — 包围盒 → 窗口几何', () => {
  it('首轮（prev 全 0）必然判定尺寸变化，窗口收到内容大小 + pad', () => {
    const d = computeFitBox(box(16, 16, 178, 32), BOUNDS, FIRST);
    expect(d).not.toBeNull();
    expect(d!.box).toEqual({ l: 16 - PAD, t: 16 - PAD, w: 178 + PAD * 2, h: 32 + PAD * 2 });
    expect(d!.sizeChanged).toBe(true);
    expect(d!.posChanged).toBe(true);
    expect(d!.dx).toBe(16 - PAD);
    expect(d!.dy).toBe(16 - PAD);
  });

  it('与上一轮完全一致 → 返回 null（不发无谓的 setSize / setPosition）', () => {
    const prev: FitBox = { l: 16 - PAD, t: 16 - PAD, w: 178 + PAD * 2, h: 32 + PAD * 2 };
    expect(computeFitBox(box(16, 16, 178, 32), BOUNDS, prev)).toBeNull();
  });

  it('尺寸只变 1px → 低于阈值，判定为「不用动」（避免窗口抽搐）', () => {
    const prev: FitBox = { l: 16 - PAD, t: 16 - PAD, w: 178 + PAD * 2, h: 32 + PAD * 2 };
    const d = computeFitBox(box(16, 16, 179, 32), BOUNDS, prev);
    expect(d).toBeNull();
  });

  it('位移 1px 也要补正（位移阈值更严，否则四周留一条透明缝）', () => {
    const prev: FitBox = { l: 16 - PAD, t: 16 - PAD, w: 178 + PAD * 2, h: 32 + PAD * 2 };
    const d = computeFitBox(box(17, 16, 178, 32), BOUNDS, prev);
    expect(d).not.toBeNull();
    expect(d!.posChanged).toBe(true);
    expect(d!.sizeChanged).toBe(false);
    expect(d!.dx).toBe(1);
    expect(d!.dy).toBe(0);
  });

  it('上界是上限：内容比工作区大时窗口也不超出工作区', () => {
    const d = computeFitBox(box(0, 0, 2000, 1200), BOUNDS, FIRST);
    expect(d!.box.w).toBe(BOUNDS.w);
    expect(d!.box.h).toBe(BOUNDS.h);
    expect(d!.box.l).toBe(0);
    expect(d!.box.t).toBe(0);
  });

  it('无负原点时负偏移（内容向左/上探出）仍钳在 0，不跟着跑到窗口外', () => {
    // 菜单向左探出 40px：left = -40 → floor(-40) - pad → 钳到 0
    const d = computeFitBox(box(-40, -40, 200, 100), BOUNDS, FIRST);
    expect(d!.box.l).toBe(0);
    expect(d!.box.t).toBe(0);
    // 尺寸从原点量到对边 + pad，不能因为负偏移而缩水
    expect(d!.box.w).toBe(160 + PAD);
    expect(d!.box.h).toBe(60 + PAD);
  });

  it('上界带负原点时窗口原点可以为负（浮层翻到胶囊上方 = 窗口向上长）', () => {
    // 胶囊在屏幕下方：工作区上沿在层坐标 -353；菜单整块在锚点上方（top=-200）
    const bounds = { x: 0, y: -353, w: 1440, h: 900 };
    const d = computeFitBox(box(16, -200, 180, 200), bounds, FIRST);
    expect(d!.box.t).toBe(-200);
    expect(d!.box.l).toBe(16);
    // 窗口盖住工作区上沿到菜单下沿，且不越出工作区
    expect(d!.box.h).toBe(200);
    expect(d!.box.t + d!.box.h).toBeLessThanOrEqual(bounds.y + bounds.h);
  });

  it('上界负原点外的内容被钳回上沿（窗口不越出工作区）', () => {
    const bounds = { x: 0, y: -353, w: 1440, h: 900 };
    const d = computeFitBox(box(16, -500, 180, 100), bounds, FIRST);
    expect(d!.box.t).toBe(-353);
    expect(d!.box.t + d!.box.h).toBeLessThanOrEqual(bounds.y + bounds.h);
  });

  it('右下越界时尺寸被上界裁掉，不产生负宽高', () => {
    const d = computeFitBox(box(1300, 800, 500, 500), BOUNDS, FIRST);
    expect(d!.box.w).toBe(BOUNDS.w - d!.box.l);
    expect(d!.box.h).toBe(BOUNDS.h - d!.box.t);
    expect(d!.box.w).toBeGreaterThan(0);
    expect(d!.box.h).toBeGreaterThan(0);
  });

  it('edges 为 null / 上界非法 → null，不抛错', () => {
    expect(computeFitBox(null, BOUNDS, FIRST)).toBeNull();
    expect(computeFitBox(box(1, 1, 10, 10), { w: 0, h: 900 }, FIRST)).toBeNull();
  });

  it('阈值可注入：换一组 pad 时窗口按新余量外扩', () => {
    const d = computeFitBox(box(16, 16, 178, 32), BOUNDS, FIRST, {
      pad: 6,
      minSizeDelta: 2,
      minPosDelta: 1,
    });
    expect(d!.box).toEqual({ l: 10, t: 10, w: 190, h: 44 });
  });
});

describe('toLayerRect — 视口坐标 → 布局坐标', () => {
  it('无平移无滚动时是恒等变换', () => {
    const r = { left: 10, top: 20, right: 100, bottom: 60 };
    expect(toLayerRect(r, { l: 0, t: 0 }, { x: 0, y: 0 })).toEqual(r);
  });

  it('把 layer 的 translate 与滚动量都加回去（漏一个就会正反馈抖动）', () => {
    const r = { left: 10, top: 20, right: 100, bottom: 60 };
    expect(toLayerRect(r, { l: 13, t: 7 }, { x: 3, y: 5 })).toEqual({
      left: 26,
      top: 32,
      right: 116,
      bottom: 72,
    });
  });
});
