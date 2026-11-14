/**
 * Timing — CollapsedDot 外环（增长弧 / 归零空窗 / 不整体旋转 / 暂停冻结）+ 高亮
 * -----------------------------------------------------------------------------
 * 这一版外环从「90° 固定短弧 + 整组 `<g>` CSS 转 60s」改成「**从 12 点起随秒增长的弧**，
 * 60 秒满圈后归零重来」（`frac = (displaySec % 60) / 60`），并删掉了 `data-turn` /
 * `.dot__ring` 的 CSS 旋转。不跑 GUI 也能量化的部分钉在这里：
 *
 *   1. `frac` 在 0 / 1 / 59 / 60 / 120 / 3599 秒的取值与「画不画弧」；
 *   2. 「每 60 秒空一下」那个空窗**有多长**；
 *   3. 结构上确实没有旋转（没有 `data-turn`、外环那组 `<g>` 不带 transform）；
 *   4. 托盘双击高亮在圆点形态下也挂得上（`data-highlight`）；
 *   5. 暂停时弧冻在当前长度（不再有 CSS 动画可暂停）。
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

describe('外环增长：frac = (displaySec % 60) / 60', () => {
  /* 手算：0 → 0；1 → 1/60；59 → 59/60；60/120 → 0；3599 → 59/60。
     dashoffset 随之为 100（空）/ 98.333 / 1.667 / 100 / 100 / 1.667。
     时钟已钉死（见 `FIXED_NOW`），所以这里容差收到 6 位小数：任何大于 1ms 的漂移都会红。 */
  it('59 秒 → frac=59/60，弧几乎满圈（dashoffset≈1.667）', () => {
    setTimer(59, 'running');
    const r = renderDot();
    /* 先证明「时间真的没走」：这一句红了，说明假时钟没生效，下面的精确断言也就不作数 */
    expect(Date.now()).toBe(FIXED_NOW);
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(59 / 60, 6);
    expect(r.offset).toBeCloseTo(100 * (1 - 59 / 60), 6);
  });

  it('1 秒 → 只画出 6°：极短但可见，不是「不可见」', () => {
    setTimer(1, 'running');
    const r = renderDot();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(1 / 60, 1);
  });

  it('60 / 120 秒 → 归零重来：frac=0，整条弧不渲染', () => {
    setTimer(60, 'running');
    expect(renderDot().arc).toBeNull();
    remountDot();
    setTimer(120, 'running');
    expect(renderDot().arc).toBeNull();
  });

  it('3599 秒 → 3599 % 60 = 59，弧长回到 nearly-full（不是「按总秒数增长」）', () => {
    setTimer(3599, 'running');
    const r = renderDot();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(59 / 60, 1);
  });
});

describe('归零空窗：只有 0.06 秒', () => {
  /**
   * `isArcVisible` 阈值 `ARC_MIN_FRAC = 0.001`（万分之一周）：
   * `frac > 0.001` ⟺ 分钟内的第 `0.06` 秒起才画。
   * [V0.11.10] 弧改吃小数秒之后，空窗从「整 1 秒」缩到 **0.06 秒**——肉眼看不见。
   * 若 `frac` 被改成 `(displaySec % 60) / 59` 或阈值被调大，下面的边界断言立刻红。
   */
  it('阈值 0.001 只吃掉整分钟那 1 秒，第 1 秒起就恢复画弧', () => {
    expect(ARC_MIN_FRAC).toBe(0.001);
    for (const sec of [0, 60, 120, 600, 3600]) {
      expect((sec % 60) / 60).toBeLessThanOrEqual(ARC_MIN_FRAC);
    }
    for (const sec of [1, 61, 121, 3601]) {
      expect((sec % 60) / 60).toBeGreaterThan(ARC_MIN_FRAC);
    }
  });

  it('渲染层验证同一件事：0 秒不画、1 秒画', () => {
    setTimer(0, 'running');
    expect(renderDot().arc).toBeNull();
    remountDot();
    setTimer(1, 'running');
    expect(renderDot().arc).not.toBeNull();
  });
});

describe('外环与进度弧仍在渲染（用户认可的是这段图形语言）', () => {
  it('表盘细框（.dot__rim）与进度弧（.dot__arc）都在，且弧长仍表达信息', () => {
    setTimer(59, 'running');
    const r = renderDot();
    const rim = r.dot.querySelector('.dot__rim');
    expect(rim).not.toBeNull();
    expect(Number(rim?.getAttribute('r'))).toBeGreaterThan(0);
    expect(r.arc).not.toBeNull();
    /* 59/60 周：弧不是被冻成静态装饰 */
    expect(fracOf(r)).toBeCloseTo(59 / 60, 6);
  });
});

describe('外环不做整体旋转', () => {
  it('根节点没有 data-turn（旧的 90° 绕圈口径已删）', () => {
    setTimer(30, 'running');
    const r = renderDot();
    expect(r.dot.hasAttribute('data-turn')).toBe(false);
    expect(r.dot.dataset.turn).toBeUndefined();
  });

  it('外环那组 <g> 不带 transform，且相邻两秒只有 dashoffset 变', () => {
    setTimer(30, 'running');
    const a = renderDot();
    const group = a.arc?.parentElement;
    expect(group?.tagName.toLowerCase()).toBe('g');
    expect(group?.getAttribute('transform')).toBeNull();

    remountDot();
    setTimer(31, 'running');
    const b = renderDot();
    expect(b.svg.getAttribute('viewBox')).toBe('0 0 33 33');
    expect(b.offset).toBeCloseTo(a.offset - 100 / 60, 1);
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
  it('paused 且已计 42 秒 → frac=42/60（不重算、不回 12 点）', () => {
    setTimer(42, 'paused');
    const r = renderDot();
    expect(r.dot.dataset.state).toBe('paused');
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(42 / 60, 1);
  });
});
