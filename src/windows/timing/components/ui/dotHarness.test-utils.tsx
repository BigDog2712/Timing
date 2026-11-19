/**
 * Timing — CollapsedDot 测试夹具（[0.13.x] 黄点版）
 * -----------------------------------------------------------------------------
 * 圆点的用例拆两处（单文件 ≤300 行，AGENTS.md 硬约束）：
 *   · `CollapsedDot.test.tsx`     —— 外环（增长弧 / 归零空窗 / 不整体旋转 / 暂停冻结）+ 高亮；
 *   · `CollapsedDotMark.test.tsx` —— 黄点位置（正计时 / 倒计时两种口径）+ 结构（分针轴心已删）。
 * 两边共用本夹具：假时钟、会话构造、渲染、「从 DOM 反推几何量」。
 *
 * 时钟为什么要钉死（[0.11.20-debt] 修 flaky）：`visible = 100 × frac` 量纲是 100，
 * 1 位小数的容差 0.05 折算成时间只有 **30ms**。`runningSince` 取 `Date.now()`，冷启动第一次跑
 * （模块转译 + React 首次挂载）轻松超过 30ms → 偶发红。修法不是放宽容差，而是
 * `vi.useFakeTimers()` + `vi.setSystemTime()` 把 `Date.now()` 恒等于 `FIXED_NOW`；
 * rAF / 定时器 / `performance` 一起假掉，`useSmoothTimerTick` 的逐帧循环不会插进来重算一次。
 * 钉死之后容差反而**收紧**到 6 位小数。
 *
 * 用例里的几何量一律**从渲染出来的 DOM 属性反推**（`dasharray → frac`、`cx/cy → 角度`、
 * 遮罩 `rotate → 环口相位`），不把组件里的公式抄一遍再自称验证过。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import { CollapsedDot } from './CollapsedDot';
import { useTimerStore, IDLE_TIMER_STATE } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { TimeRecord } from '../../types/domain';

// React 19 的 act 需要显式声明「当前是测试环境」，否则每渲染一次打一条 warning
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 钉死的「现在」（2026-01-01T00:00:00Z）：`session()` 与 `computeLiveSecFloat` 同源，
 * `delta` 必然是 0，几何量与手算值逐位相等。 */
export const FIXED_NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

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

/** 在每个用它的测试文件的**顶层**调一次（它注册的 beforeEach/afterEach 作用于该文件） */
export function registerDotHarness(): void {
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
}

/** 造一个「已计 `sec` 秒」的会话（`runningSince` 取现在，delta 为 0，秒数确定）。 */
function session(sec: number, running: boolean, countdownTargetSec: number | null = null): TimeRecord {
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
    mode: countdownTargetSec == null ? 'countup' : 'countdown',
    targetSec: countdownTargetSec,
  };
}

/** 正计时：已计 `sec` 秒 */
export function setTimer(sec: number, status: 'running' | 'paused'): void {
  useTimerStore.getState().setState({
    status,
    session: session(sec, status === 'running'),
    lastItemId: 1,
    liveDurationSec: sec,
    mode: 'countup',
    remainingSec: null,
  });
}

/** 倒计时：已计 `elapsed` 秒 / 总时长 `target` 秒 */
export function setCountdown(elapsed: number, target: number): void {
  useTimerStore.getState().setState({
    status: 'running',
    session: session(elapsed, true, target),
    lastItemId: 1,
    liveDurationSec: elapsed,
    mode: 'countdown',
    remainingSec: Math.max(0, target - elapsed),
  });
}

export interface Rendered {
  dot: HTMLButtonElement;
  svg: SVGElement;
  /** 进度弧；`isArcVisible(frac)` 为 false 时整条不渲染 → null */
  arc: SVGCircleElement | null;
  /** 进度弧 dasharray 第一段：可见弧长（`pathLength=100` 口径）；无 arc 时为 NaN */
  visible: number;
  /** 进度弧 dasharray 第二段：余量；无 arc 时为 NaN */
  gap: number;
  /** 进度弧的 SVG 旋转角（度）：固定 −90（计时 0 点在 12 点）；无 arc 时为 NaN */
  arcRotate: number;
  /** 遮罩圆（挖出黄点处的环口） */
  mask: SVGCircleElement;
  /** 遮罩 dasharray 第一段：露出的环（`pathLength=100` 口径） */
  maskVisible: number;
  /** 遮罩 dasharray 第二段：挖空的环口 */
  maskGap: number;
  /** 遮罩的 SVG 旋转角（度）：环口中心 = 黄点角度 */
  maskRotate: number;
  /** 黄点（原分针的针尖端） */
  mark: SVGCircleElement;
  /** 黄点角度（度）：0 = 12 点，顺时针；由圆周坐标反推 */
  markAngle: number;
}

/** 渲染一次并读出全部几何量 */
export function renderDot(): Rendered {
  act(() => {
    root.render(<CollapsedDot />);
  });
  const dot = container.querySelector<HTMLButtonElement>('.dot');
  if (!dot) throw new Error('未渲染 .dot');
  const svg = dot.querySelector<SVGElement>('.dot__svg');
  if (!svg) throw new Error('未渲染 .dot__svg');
  const arc = dot.querySelector<SVGCircleElement>('.dot__arc');
  const mask = dot.querySelector<SVGCircleElement>('.dot__mask');
  if (!mask) throw new Error('未渲染 .dot__mask（环口遮罩）');
  const mark = dot.querySelector<SVGCircleElement>('.dot__mark');
  if (!mark) throw new Error('未渲染 .dot__mark（黄点）');
  /* 圆心从 viewBox 反推（33 / 2 = 16.5），不在测试里抄一份常量 */
  const [, , vbW = '0'] = (svg.getAttribute('viewBox') ?? '').split(/\s+/);
  const center = Number(vbW) / 2;
  const dx = Number(mark.getAttribute('cx')) - center;
  const dy = Number(mark.getAttribute('cy')) - center;
  /* atan2(x, −y)：0° 落在 12 点、顺时针增大（与渲染口径一致） */
  const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;
  /* 可见段 / 余量直接从 dasharray 反推，不在测试里重抄比例公式 */
  const [visible = Number.NaN, gap = Number.NaN] = (arc?.getAttribute('stroke-dasharray') ?? '')
    .split(/\s+/)
    .map(Number);
  const [maskVisible = Number.NaN, maskGap = Number.NaN] = (
    mask.getAttribute('stroke-dasharray') ?? ''
  )
    .split(/\s+/)
    .map(Number);
  const rotate = /rotate\(([-\d.]+)/.exec(arc?.getAttribute('transform') ?? '');
  const maskRotate = /rotate\(([-\d.]+)/.exec(mask.getAttribute('transform') ?? '');
  return {
    dot,
    svg,
    arc,
    visible,
    gap,
    arcRotate: Number(rotate?.[1] ?? Number.NaN),
    mask,
    maskVisible,
    maskGap,
    maskRotate: Number(maskRotate?.[1] ?? Number.NaN),
    mark,
    markAngle: raw < 0 ? raw + 360 : raw,
  };
}

/** 卸载重挂：同一容器里换秒数（`root` 被重新赋值） */
export function remountDot(): void {
  act(() => {
    root.unmount();
  });
  root = createRoot(container);
}

/** 黄点的圆周坐标（断言「点位随秒数变」用） */
export function markPoint(r: Rendered): { x: number; y: number } {
  return {
    x: Number(r.mark.getAttribute('cx')),
    y: Number(r.mark.getAttribute('cy')),
  };
}

/** 从渲染结果反推 `frac`：可见段长度 ÷ 整圈（计时按绝对位置，60 秒满 100） */
export function fracOf(r: Rendered): number {
  return r.visible / 100;
}

/** 当前渲染出的 `.dot` 根节点（高亮用例要重新查一次 DOM） */
export function currentDot(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.dot');
}
