/**
 * Timing — CollapsedDot 外环（弧尾在黄点 / 弧头绝对计时 / 归零 / 暂停冻结）+ 高亮
 * -----------------------------------------------------------------------------
 * 设计口径（用户 0.13.x 最终确认）：
 *   · **UI 图形起点 = 黄点**：弧尾就是黄点，蓝弧从黄点边缘起笔；环口由遮罩挖出，
 *     随分钟点绕圈；
 *   · **计时 = 12 点（0 点）**：弧头落在绝对秒位置 `(sec % 60) × 6°`，一秒 6°，
 *     不随黄点旋转。
 * 正计时的弧因此从黄点顺时针铺到绝对秒位置；弧头追上黄点时归零。黄点自己也在走
 * 0.1°/s，所以视觉周期约 61s，但弧头始终在绝对秒位置上。
 * 不跑 GUI 也能量化的部分钉在这里：
 *
 *   1. 弧尾（`arcRotate + 90`）= 黄点角度；弧头 = `(sec % 60) × 6°`；
 *   2. 0 / 1 / 30 / 59 / 60 / 61 / 62 / 3599 秒的可见段与「画不画弧」；
 *   3. 60 秒不是归零点：60s 仍接近满圈，61→62s 之间弧头追上黄点才归零；
 *   4. 结构上没有整组 CSS 旋转（没有 `data-turn`）；遮罩相位随黄点走；
 *   5. 托盘双击高亮在圆点形态下也挂得上（`data-highlight`）；
 *   6. 暂停时弧冻在当前长度（不再有 CSS 动画可暂停）。
 *
 * [0.13.x] 分针与轴心已删、换成黄点 —— 那部分的判据在 `CollapsedDotMark.test.tsx`；
 * 本文件同时守住「外环与进度弧仍在渲染」（用户认可的是这段图形语言，别顺手删掉）。
 * 夹具（假时钟 / 会话构造 / 从 DOM 反推几何量）在 `dotHarness.test-utils.tsx`。
 */
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { ARC_MIN_FRAC } from '../../lib/ringGeometry';
import { HIGHLIGHT_MS } from '../../lib/constants';
import { useUiStore } from '../../stores/uiStore';
import { RING_GAP_DEG } from './CollapsedDot';
import {
  currentDot,
  fracOf,
  registerDotHarness,
  remountDot,
  renderDot,
  setTimer,
  FIXED_NOW,
} from './dotHarness.test-utils';

registerDotHarness();

/** 从 DOM 反推弧头角度（时钟角，0 = 12 点）：弧尾 + 可见段对应的角度 */
function headAngle(r: ReturnType<typeof renderDot>): number {
  const raw = (r.arcRotate + 90 + r.visible * 3.6) % 360;
  return raw < 0 ? raw + 360 : raw;
}

describe('正计时：弧尾在黄点，弧头在绝对秒位置', () => {
  /* 手算（秒 → 黄点角 D = sec×0.1°、弧头 T = (sec%60)×6°）：
       1s  → D≈0.1  T≈6     delta≈5.9°
       30s → D≈3    T≈180   delta≈177°
       59s → D≈5.9  T≈354   delta≈348.1°
       60s → D≈6    T≈0     delta≈354°
       61s → D≈6.1  T≈6     delta≈359.9°
       62s → D≈6.2  T≈12    delta≈5.8°（已归零）
     `useSmoothTimerTick` 逐帧推进，可能比整秒多跑一帧（约 0.02s → 0.12°）；
     所以只钉模型关系与阈值，不钉 6 位小数。 */

  it('1 秒 → 弧从黄点铺到 6°，只画出一小段', () => {
    setTimer(1, 'running');
    const r = renderDot();
    /* 先证明「时间真的没走」：这一句红了，说明假时钟没生效，下面的断言也就不作数 */
    expect(Date.now()).toBe(FIXED_NOW);
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeGreaterThan(0);
    expect(fracOf(r)).toBeLessThan(0.03);
    expect(headAngle(r)).toBeCloseTo(6, 0);
  });

  it('30 秒 → 弧尾在 3°（黄点）、弧头在 180°（绝对秒位置）', () => {
    setTimer(30, 'running');
    const r = renderDot();
    expect(r.markAngle).toBeCloseTo(3, 1);
    expect(r.arcRotate).toBeCloseTo(r.markAngle - 90, 2);
    expect(r.visible).toBeGreaterThan(45);
    expect(headAngle(r)).toBeCloseTo(180, 0);
  });

  it('59 秒 → 弧头在 354°，几乎铺满整圈（可见段 > 95%）', () => {
    setTimer(59, 'running');
    const r = renderDot();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeGreaterThan(0.95);
    expect(r.gap).toBeLessThan(5);
    expect(headAngle(r)).toBeCloseTo(354, 0);
  });

  it('3599 秒 → 弧头仍在 354°；可见段按「黄点→绝对秒」算，不是按总秒数', () => {
    setTimer(3599, 'running');
    const r = renderDot();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeGreaterThan(0.95);
    expect(headAngle(r)).toBeCloseTo(354, 0);
  });
});

describe('归零点：弧头追上黄点，不是整 60 秒', () => {
  /**
   * 60 秒只在弧头相位上归零（T=0），但弧尾在黄点（6°），所以 60s 的弧仍接近满圈；
   * 61→62s 之间弧头越过黄点，delta 从 359.9° 落到 5.8°，这才是视觉归零。
   * 若把弧尾固定回 12 点，60s 会重新变成空弧，下面的断言立刻红。
   */
  /* 用 paused 钉「0 秒」：running 的平滑秒会多走一帧（~0.02s），0.12° 的弧
     已经越过 `isArcVisible` 阈值，测不到「真的不画」。 */
  it('0 秒 → 弧头=弧尾=12 点，不画弧', () => {
    setTimer(0, 'paused');
    expect(renderDot().arc).toBeNull();
  });

  it('60 秒 → 仍接近满圈（delta=354°），不是归零', () => {
    setTimer(60, 'running');
    const r = renderDot();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeGreaterThan(0.95);
    /* 弧头回到顶部：359.999... 与 360 是同一个位置 */
    expect(headAngle(r)).toBeCloseTo(360, 0);
  });

  it('61 秒 → 仍是 359.9°；62 秒 → 5.8°（弧头越过黄点，归零）', () => {
    setTimer(61, 'running');
    const r61 = renderDot();
    expect(fracOf(r61)).toBeGreaterThan(0.99);
    expect(headAngle(r61)).toBeCloseTo(6, 0);

    remountDot();
    setTimer(62, 'running');
    const r62 = renderDot();
    expect(r62.arc).not.toBeNull();
    expect(fracOf(r62)).toBeLessThan(0.05);
    expect(headAngle(r62)).toBeCloseTo(12, 0);
  });

  it('阈值 0.001（万分之一周 ≈ 0.36°）只吃掉弧头追上弧尾的一瞬，1 秒就恢复画弧', () => {
    expect(ARC_MIN_FRAC).toBe(0.001);
    expect(5.9 / 360).toBeGreaterThan(ARC_MIN_FRAC);
  });
});

describe('外环与进度弧仍在渲染（用户认可的是这段图形语言）', () => {
  it('环就是进度弧（.dot__arc），没有半透明底环，且弧长仍表达信息', () => {
    setTimer(59, 'running');
    const r = renderDot();
    expect(r.dot.querySelector('.dot__rim')).toBeNull();
    expect(r.arc).not.toBeNull();
    /* 弧不是被冻成静态装饰：弧长仍按秒数铺到接近整圈 */
    expect(fracOf(r)).toBeGreaterThan(0.95);
  });
});

describe('外环不做整组 CSS 旋转；相位由 transform 表达', () => {
  it('根节点没有 data-turn（旧的 90° 绕圈口径已删）', () => {
    setTimer(30, 'running');
    const r = renderDot();
    expect(r.dot.hasAttribute('data-turn')).toBe(false);
    expect(r.dot.dataset.turn).toBeUndefined();
    expect(r.arc?.closest('g')?.getAttribute('mask')).toMatch(/^url\(#dot-gap-/);
  });

  it('弧尾跟黄点走 0.1°/s；弧头绝对位置走 6°/s；遮罩同步跟黄点', () => {
    setTimer(30, 'running');
    const a = renderDot();
    /* 弧尾 = 黄点：arcRotate + 90 = markAngle */
    expect(a.arcRotate).toBeCloseTo(a.markAngle - 90, 2);
    /* 环口中心 = 黄点角度：markAngle 由 round3 后的 cx/cy 反推，容差 2 位 */
    expect(a.maskRotate).toBeCloseTo(a.markAngle - 90 + RING_GAP_DEG / 2, 2);

    remountDot();
    setTimer(31, 'running');
    const b = renderDot();
    expect(b.svg.getAttribute('viewBox')).toBe('0 0 33 33');
    /* 可见段每秒增长 5.9°（弧头 6°/s − 弧尾 0.1°/s） */
    expect(b.visible).toBeCloseTo(a.visible + 5.9 / 3.6, 1);
    expect(b.gap).toBeCloseTo(a.gap - 5.9 / 3.6, 1);
    /* 弧尾 / 遮罩跟黄点走 0.1°；弧头从 180° 到 186°，绝对位置每秒 6° */
    expect(b.arcRotate).toBeCloseTo(a.arcRotate + 0.1, 1);
    expect(b.maskRotate).toBeCloseTo(a.maskRotate + 0.1, 1);
    expect(headAngle(a)).toBeCloseTo(180, 0);
    expect(headAngle(b)).toBeCloseTo(186, 0);
  });
});

describe('托盘双击 → 圆点也能高亮', () => {
  it('初始不闪：highlightSeq 从 0 起步', () => {
    setTimer(10, 'running');
    expect(renderDot().dot.dataset.highlight).toBe('false');
  });

  it('flashHighlight() 之后挂上 data-highlight（PillBar 卸载时圆点是唯一载体）', () => {
    setTimer(10, 'running');
    renderDot();
    act(() => {
      useUiStore.getState().flashHighlight();
    });
    expect(currentDot()?.dataset.highlight).toBe('true');
  });

  it('保持时长覆盖完整三次闪烁（CSS 0.8s × 3 = 2400ms），否则最后一次被截断', () => {
    expect(HIGHLIGHT_MS).toBeGreaterThanOrEqual(2400);
  });
});

describe('暂停时弧长冻结', () => {
  it('paused 且已计 42 秒 → delta=247.8°（不重算、不回 12 点）', () => {
    setTimer(42, 'paused');
    const r = renderDot();
    expect(r.dot.dataset.state).toBe('paused');
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeGreaterThan(0.68);
    expect(fracOf(r)).toBeLessThan(0.70);
    expect(headAngle(r)).toBeCloseTo(252, 0);
  });
});
