/**
 * Timing — CollapsedDot 圆点几何（V0.11.5）
 * -----------------------------------------------------------------------------
 * 这一版把外环从「90° 固定短弧 + 整组 `<g>` CSS 转 60s」改成「**从 12 点起随秒增长的弧**，
 * 60 秒满圈后归零重来」（`frac = (displaySec % 60) / 60`），并删掉了 `data-turn` /
 * `.dot__ring` 的 CSS 旋转。不跑 GUI 也能量化的部分全部钉在这里：
 *
 *   1. `frac` 在 0 / 1 / 59 / 60 / 120 / 3599 秒的取值与「画不画弧」；
 *   2. 「每 60 秒空一下」那个空窗**有多长**；
 *   3. 分针 `(displaySec % 3600) * 0.1` 在 3599 / 3600 秒的度数，以及有没有跳变；
 *   4. 结构上确实没有旋转（没有 `data-turn`、外环那组 `<g>` 不带 transform）；
 *   5. 托盘双击高亮在圆点形态下也挂得上（`data-highlight`）；
 *   6. 暂停时弧冻在当前长度（不再有 CSS 动画可暂停）。
 *
 * [V0.11.10] 几何量改吃「带小数的秒」逐帧推进（弧不再一秒一跳）。
 *
 * [0.11.20-debt] 修 flaky：`dashoffset = 100 × (1 − frac)` 量纲是 100，1 位小数的容差
 * 0.05 折算成时间只有 **30ms**（0.05 ÷ (100/60) = 0.03 s）。`runningSince` 取 `Date.now()`，
 * 冷启动第一次跑（模块转译 + React 首次挂载）轻松超过 30ms → 偶发红、第二次又绿。
 * 修法不是放宽容差，而是**把时钟钉死**：`vi.useFakeTimers()` + `vi.setSystemTime()` 之后
 * `Date.now()` 恒等于 `FIXED_NOW`，`delta = 0`；rAF / 定时器 / `performance` 一起假掉
 * （`toFake` 显式列出），`useSmoothTimerTick` 的逐帧循环不会插进来重算一次。
 * 时钟钉死之后容差反而**收紧**到 6 位小数（5e-7）：漂移 1ms 都会红，这才叫钉住了。
 *
 * 断言的是**结构契约**（属性值 / 元素在不在），不做截图：33px 的环好不好看要靠人眼，
 * 但「第 60 秒整圈消失」这种缺陷一定能被 `stroke-dashoffset` 的数值钉死在结构上。
 *
 * `frac` 目前是 `CollapsedDot` 里的内联表达式，不是 `lib/ringGeometry` 的导出。这里从
 * **渲染出来的 SVG 属性**反推它（`dashoffset = 100 × (1 − frac)`），所以测的仍是真实
 * 渲染路径，而不是把公式抄一遍再自称验证过。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollapsedDot } from './CollapsedDot';
import { ARC_MIN_FRAC } from '../../lib/ringGeometry';
import { HIGHLIGHT_MS } from '../../lib/constants';
import { useTimerStore, IDLE_TIMER_STATE } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { TimeRecord } from '../../types/domain';

// React 19 的 act 需要显式声明「当前是测试环境」，否则每渲染一次打一条 warning
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 钉死的「现在」（2026-01-01T00:00:00Z）：`session()` 与 `computeLiveSecFloat` 同源，
 * `delta` 必然是 0，几何量与手算值逐位相等。 */
const FIXED_NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

/** 假掉的时间源：时钟 + 逐帧 + 定时器 + `performance`，全部由用例控制，不与真实耗时赛跑。 */
const FAKED_TIMERS = [
  'Date',
  'performance',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
  vi.setSystemTime(FIXED_NOW);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  /* 每个用例从干净状态起：idle、无高亮、无结束瞬时标记 */
  useTimerStore.getState().setState(IDLE_TIMER_STATE);
  useUiStore.setState({ highlightSeq: 0, endedAt: null });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

/** 造一个「已计 `sec` 秒」的会话（`runningSince` 取现在，delta 为 0，秒数确定）。 */
function session(sec: number, running: boolean): TimeRecord {
  const now = Date.now();
  return {
    id: 1,
    itemId: 1,
    status: 'active',
    startedAt: now - sec * 1000,
    endedAt: null,
    accumulatedSec: sec,
    runningSince: running ? now : null,
    note: null,
    mode: 'countup',
    targetSec: null,
  };
}

function setTimer(sec: number, status: 'running' | 'paused') {
  useTimerStore.getState().setState({
    status,
    session: session(sec, status === 'running'),
    lastItemId: 1,
    liveDurationSec: sec,
    mode: 'countup',
    remainingSec: null,
  });
}

interface Rendered {
  dot: HTMLButtonElement;
  svg: SVGElement;
  /** 进度弧；`isArcVisible(frac)` 为 false 时整条不渲染 → null */
  arc: SVGCircleElement | null;
  /** `stroke-dashoffset`（0 = 整周、100 = 空）；无 arc 时为 NaN */
  offset: number;
  /** 分针旋转角度（度） */
  needleAngle: number;
}

function render(): Rendered {
  act(() => {
    root.render(<CollapsedDot />);
  });
  const dot = container.querySelector<HTMLButtonElement>('.dot');
  if (!dot) throw new Error('未渲染 .dot');
  const svg = dot.querySelector<SVGElement>('.dot__svg');
  if (!svg) throw new Error('未渲染 .dot__svg');
  const arc = dot.querySelector<SVGCircleElement>('.dot__arc');
  const needle = dot.querySelector<SVGLineElement>('.dot__needle');
  if (!needle) throw new Error('未渲染 .dot__needle');
  const transform = needle.getAttribute('transform') ?? '';
  return {
    dot,
    svg,
    arc,
    offset: Number(arc?.getAttribute('stroke-dashoffset') ?? Number.NaN),
    needleAngle: Number(/rotate\(\s*(-?[\d.eE+-]+)/.exec(transform)?.[1] ?? Number.NaN),
  };
}

/** 从渲染结果反推 `frac`：`arcDashOffset` 的定义是 `100 × (1 − frac)`。 */
function fracOf(r: Rendered): number {
  return 1 - r.offset / 100;
}

/** 卸载重挂：部分用例要在同一容器里换秒数（`root` 被重新赋值）。 */
function remount() {
  act(() => {
    root.unmount();
  });
  root = createRoot(container);
}

describe('外环增长：frac = (displaySec % 60) / 60', () => {
  /* 手算：0 → 0；1 → 1/60；59 → 59/60；60/120 → 0；3599 → 59/60。
     dashoffset 随之为 100（空）/ 98.333 / 1.667 / 100 / 100 / 1.667。
     时钟已钉死（见 `FIXED_NOW`），所以这里容差收到 6 位小数：任何大于 1ms 的漂移都会红。 */
  it('59 秒 → frac=59/60，弧几乎满圈（dashoffset≈1.667）', () => {
    setTimer(59, 'running');
    const r = render();
    /* 先证明「时间真的没走」：这一句红了，说明假时钟没生效，下面的精确断言也就不作数 */
    expect(Date.now()).toBe(FIXED_NOW);
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(59 / 60, 6);
    expect(r.offset).toBeCloseTo(100 * (1 - 59 / 60), 6);
  });

  it('1 秒 → 只画出 6°：极短但可见，不是「不可见」', () => {
    setTimer(1, 'running');
    const r = render();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(1 / 60, 1);
  });

  it('60 / 120 秒 → 归零重来：frac=0，整条弧不渲染', () => {
    setTimer(60, 'running');
    expect(render().arc).toBeNull();
    remount();
    setTimer(120, 'running');
    expect(render().arc).toBeNull();
  });

  it('3599 秒 → 3599 % 60 = 59，弧长回到 nearly-full（不是「按总秒数增长」）', () => {
    setTimer(3599, 'running');
    const r = render();
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(59 / 60, 1);
  });
});

describe('归零空窗：一秒，每分钟一次', () => {
  /**
   * `isArcVisible` 阈值 `ARC_MIN_FRAC = 0.001`（万分之一周）：
   * `frac > 0.001` ⟺ 分钟内的第 `0.06` 秒起才画。
   * [V0.11.10] 弧改吃小数秒之后，空窗从「整 1 秒」缩到 **0.06 秒**——肉眼看不见，
   * 这正是「整分钟闪一下」被消掉的原因。
   *
   * 既是「算出来的答案」，也是护栏：若 `frac` 被改成 `(displaySec % 60) / 59`
   * 或阈值被调大，下面的边界断言立刻红。
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
    expect(render().arc).toBeNull();
    remount();
    setTimer(1, 'running');
    expect(render().arc).not.toBeNull();
  });
});

describe('分针 needleAngle = (displaySec % 3600) * 0.1', () => {
  it('3599 秒 → 359.9°（几乎回到 12 点）', () => {
    setTimer(3599, 'running');
    expect(render().needleAngle).toBeCloseTo(359.9, 1);
  });

  it('3600 秒 → 0°；与 359.9° 的圆周距离只有 0.1°（向前，不跳变）', () => {
    setTimer(3600, 'running');
    const at = render().needleAngle;
    expect(at).toBeCloseTo(0, 1);
    /* 走「向前 0.1°」而不是「倒退 359.9°」 */
    const forward = (at - 359.9 + 360) % 360;
    expect(forward).toBeCloseTo(0.1, 1);
    expect(forward).toBeLessThan(1);
  });

  it('跨小时不累积：3660 秒 = 60 秒的针位（6°）', () => {
    setTimer(3660, 'running');
    expect(render().needleAngle).toBeCloseTo(6, 1);
  });
});

describe('外环不做整体旋转', () => {
  it('根节点没有 data-turn（旧的 90° 绕圈口径已删）', () => {
    setTimer(30, 'running');
    const r = render();
    expect(r.dot.hasAttribute('data-turn')).toBe(false);
    expect(r.dot.dataset.turn).toBeUndefined();
  });

  it('外环那组 <g> 不带 transform，且相邻两秒只有 dashoffset 变', () => {
    setTimer(30, 'running');
    const a = render();
    const group = a.arc?.parentElement;
    expect(group?.tagName.toLowerCase()).toBe('g');
    expect(group?.getAttribute('transform')).toBeNull();

    remount();
    setTimer(31, 'running');
    const b = render();
    expect(b.svg.getAttribute('viewBox')).toBe('0 0 33 33');
    expect(b.offset).toBeCloseTo(a.offset - 100 / 60, 1);
  });
});

describe('托盘双击 → 圆点也能高亮', () => {
  it('初始不闪：highlightSeq 从 0 起步', () => {
    setTimer(10, 'running');
    expect(render().dot.dataset.highlight).toBe('false');
  });

  it('flashHighlight() 之后挂上 data-highlight（PillBar 卸载时圆点是唯一载体）', () => {
    setTimer(10, 'running');
    render();
    act(() => {
      useUiStore.getState().flashHighlight();
    });
    expect(container.querySelector<HTMLElement>('.dot')?.dataset.highlight).toBe('true');
  });

  it('保持时长覆盖完整三次闪烁（CSS 0.8s × 3 = 2400ms），否则最后一次被截断', () => {
    expect(HIGHLIGHT_MS).toBeGreaterThanOrEqual(2400);
  });
});

describe('暂停时弧长冻结', () => {
  it('paused 且已计 42 秒 → frac=42/60（不重算、不回 12 点）', () => {
    setTimer(42, 'paused');
    const r = render();
    expect(r.dot.dataset.state).toBe('paused');
    expect(r.arc).not.toBeNull();
    expect(fracOf(r)).toBeCloseTo(42 / 60, 1);
  });
});
