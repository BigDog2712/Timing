/**
 * Timing — MainButton（状态环）弧语义单测（V0.3.6 / ADR-024）
 * -----------------------------------------------------------------------------
 * **禁止 renderToStaticMarkup**：zustand v5 的 `useSyncExternalStore` 在 SSR 下会读到
 * 初始 state（服务端没有 store 快照），把「已 armed / 已 running」的状态渲染成 idle，
 * 于是测试断言的不是真实 DOM。这里一律 `createRoot` + `act`，跑的是浏览器那条渲染路径。
 *
 * 断言的都是**结构契约**（data-spin / data-thick / 是否渲染 track+bar / dashoffset），
 * 不做截图比对：环只有 16px，视觉差异要靠人眼，但「倒计时被行进」这种缺陷
 * 一定能被 `data-spin="false"` 钉死在结构上。
 *
 * [V0.3.7] 全状态单一载体：**每一种状态都渲染同一个 `<svg>`**（idle / ended 不再有
 * 「不渲染 svg、回落 border」的分支），形状由 `lib/ringGeometry.ts` 的超椭圆 ARC_PATH 独占。
 * idle 未待命 = 整周弧无轨；ended = 整周弧无轨 + `data-thick` 加粗描边。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MainButton } from './MainButton';

// React 19 的 act 需要显式声明「当前是测试环境」，否则每渲染一次打一条 warning
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

interface Rendered {
  ring: HTMLElement;
  svg: SVGElement | null;
  track: SVGPathElement | null;
  bar: SVGPathElement | null;
  /** bar 的 stroke-dashoffset（0 = 整周可见、100 = 完全不可见）；无 bar 时为 NaN */
  offset: number;
  /** bar 的 stroke-dasharray 原始串（"100" = 静态整段；"25 75" = 行进短弧） */
  dasharray: string | null;
}

function render(props: Partial<Parameters<typeof MainButton>[0]> = {}): Rendered {
  act(() => {
    root.render(<MainButton state="idle" label="测试环" onClick={() => undefined} {...props} />);
  });
  const ring = container.querySelector<HTMLElement>('.ring');
  if (!ring) throw new Error('未渲染 .ring');
  const bar = ring.querySelector<SVGPathElement>('.ring__arc-bar');
  return {
    ring,
    svg: ring.querySelector<SVGElement>('.ring__arc'),
    track: ring.querySelector<SVGPathElement>('.ring__arc-track'),
    bar,
    offset: Number(bar?.getAttribute('stroke-dashoffset') ?? Number.NaN),
    dasharray: bar?.getAttribute('stroke-dasharray') ?? null,
  };
}

describe('倒计时 running（D1：递减弧只收缩、不行进）', () => {
  it('data-spin=false，弧长 = 剩余比例，track 存在，dasharray 走整段口径', () => {
    const r = render({ state: 'running', countdown: true, progress: 0.4 });
    expect(r.ring.dataset.spin).toBe('false');
    expect(r.svg).not.toBeNull();
    expect(r.track).not.toBeNull();
    expect(r.dasharray).toBe('100');
    expect(r.offset).toBeCloseTo(60, 6); // 100 × (1 − 0.4)
  });

  it('进度变化只改 dashoffset，不改 spin', () => {
    const half = render({ state: 'running', countdown: true, progress: 0.5 });
    expect(half.offset).toBeCloseTo(50, 6);
    expect(half.ring.dataset.spin).toBe('false');
    const almost = render({ state: 'running', countdown: true, progress: 0.05 });
    expect(almost.offset).toBeCloseTo(95, 6);
    expect(almost.ring.dataset.spin).toBe('false');
  });

  it('越界 progress 被钳住（不画出 >100% 的脏 dashoffset）', () => {
    expect(render({ state: 'running', countdown: true, progress: 3 }).offset).toBeCloseTo(0, 6);
    // 负值钳到 0 = 不可见，与 D5 同一条路：整条 bar 不渲染（不是画一个 100 的脏 offset）
    expect(render({ state: 'running', countdown: true, progress: -1 }).bar).toBeNull();
  });
});

describe('正计时 running（90° 弧 + 旋转 + track）', () => {
  it('dasharray 走行进口径 "25 75"（90° 短弧），data-spin=true，带 track', () => {
    const r = render({ state: 'running' });
    expect(r.dasharray).toBe('25 75');
    // 行进态静态 offset 取 0：动画把 dashoffset 从 0 推到 −100 沿路径走一圈
    expect(r.offset).toBeCloseTo(0, 6);
    expect(r.ring.dataset.spin).toBe('true');
    expect(r.track).not.toBeNull();
    expect(r.bar).not.toBeNull();
  });

  it('带 countdown=false 时不会误读 progress（弧长恒 90°）', () => {
    const r = render({ state: 'running', countdown: false, progress: 0.9 });
    expect(r.dasharray).toBe('25 75');
    expect(r.ring.dataset.spin).toBe('true');
  });
});

describe('paused：两模式统一 270° 静弧（D3）', () => {
  it('正计时 paused → dashoffset 25、不行进、带 track', () => {
    const r = render({ state: 'paused' });
    expect(r.offset).toBeCloseTo(25, 6); // 100 × (1 − 0.75)
    expect(r.dasharray).toBe('100');
    expect(r.ring.dataset.spin).toBe('false');
    expect(r.track).not.toBeNull();
  });

  it('倒计时 paused 也走 270°，不再显示冻结的进度弧', () => {
    const r = render({ state: 'paused', countdown: true, progress: 0.2 });
    expect(r.offset).toBeCloseTo(25, 6); // 不是 100 × (1 − 0.2) = 80
    expect(r.dasharray).toBe('100');
    expect(r.ring.dataset.spin).toBe('false');
    expect(r.track).not.toBeNull();
  });
});

describe('idle 两副面孔（D4：待命态不得画成「进行中」）', () => {
  it('未待命 → 整周弧、无轨（V0.3.7：不再回落 border，但无 track 不画成「量进度中」）', () => {
    const r = render({ state: 'idle' });
    expect(r.svg).not.toBeNull();
    expect(r.track).toBeNull();
    expect(r.bar).not.toBeNull();
    expect(r.dasharray).toBe('100');
    expect(r.offset).toBeCloseTo(0, 6); // 整周可见
    expect(r.ring.dataset.spin).toBe('false');
    expect(r.ring.dataset.thick).toBe('false');
  });

  it('待命（armedIdle）→ 全周弧 + 全周 track，静态不行进', () => {
    const r = render({ state: 'idle', countdown: true, progress: 1 });
    expect(r.svg).not.toBeNull();
    expect(r.offset).toBeCloseTo(0, 6); // 整周可见
    expect(r.dasharray).toBe('100');
    expect(r.track).not.toBeNull();
    expect(r.ring.dataset.spin).toBe('false');
  });
});

describe('ended：整周弧 + data-thick 加粗描边（V0.3.7：border 退场）', () => {
  it('即便带着 countdown / progress 也走全周弧，track 不渲染、描边加粗', () => {
    const r = render({ state: 'ended', countdown: true, progress: 0.5 });
    expect(r.svg).not.toBeNull();
    expect(r.track).toBeNull(); // 加粗整周弧上再叠 37% 底轨是多余的暗圈
    expect(r.bar).not.toBeNull();
    expect(r.dasharray).toBe('100');
    expect(r.offset).toBeCloseTo(0, 6);
    expect(r.ring.dataset.spin).toBe('false');
    expect(r.ring.dataset.thick).toBe('true');
  });
});

describe('归零不残留圆点（D5）', () => {
  it('progress=0 → bar 整条不渲染，track 仍在（环不塌）', () => {
    const r = render({ state: 'running', countdown: true, progress: 0 });
    expect(r.svg).not.toBeNull();
    expect(r.track).not.toBeNull();
    expect(r.bar).toBeNull();
  });

  it('极小残值（≤ ARC_MIN_FRAC）同样不渲染 bar', () => {
    expect(render({ state: 'running', countdown: true, progress: 0.0005 }).bar).toBeNull();
  });

  it('刚过阈值就恢复渲染（阈值不是「永远不画」）', () => {
    const r = render({ state: 'running', countdown: true, progress: 0.01 });
    expect(r.bar).not.toBeNull();
    expect(r.dasharray).toBe('100');
    expect(r.offset).toBeCloseTo(99, 6);
  });
});

describe('交互契约不因改结构而回退', () => {
  it('onClick 仍挂在环上；带 onMenu 时 aria-label 追加右键提示', () => {
    let clicked = 0;
    const r = render({ onClick: () => { clicked += 1; }, onMenu: () => undefined });
    expect(r.ring.getAttribute('aria-label')).toBe('测试环（右键结束或菜单）');
    act(() => {
      r.ring.click();
    });
    expect(clicked).toBe(1);
  });
});
