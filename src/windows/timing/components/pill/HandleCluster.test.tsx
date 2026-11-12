/**
 * 药丸手柄区的**行为**单测（H-01 / H-02 / H-03 / H-05 / H-06 / W-07）
 * -----------------------------------------------------------------------------
 * jsdom **不做布局**：`offsetWidth` 恒为 0、rect 全零、外部 CSS 不参与计算。所以 H-02 的
 * `offsetWidth === 0` 不可能靠"量 DOM"验证，改为「结构 + 属性 + 读样式源码」两条口径。
 * 宽度算式（W-01…W-06 / R-03）已按 0.12.1 末的行数上限拆到 `HandleGeometry.test.tsx`。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from 'node:path';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from 'node:url';

import { DEFAULT_HANDLE_BINDINGS, HANDLE_FORMS } from '../../lib/handleCatalog';
import type { HandleBindings, HandleSlot } from '../../lib/handleCatalog';
import type { HandleActionCtx } from '../../services/handleActions/guards';
import { HandleCluster } from './HandleCluster';

/** `src/components/pill/` → `src/` */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

type Ctx = Omit<HandleActionCtx, 'anchor'>;

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    status: 'idle',
    itemId: null,
    /* 8 个计时动作全给 vi.fn()：本文件只关心"有没有被调到"，不关心时序 */
    timer: {
      start: vi.fn(), togglePause: vi.fn(), stop: vi.fn(), undo: vi.fn(),
      switchTo: vi.fn(), startOrSwitch: vi.fn(), discardCurrent: vi.fn(), resolveRecover: vi.fn(),
    },
    ui: {
      openPanel: vi.fn(),
      openNotesList: vi.fn(),
      openCountdownMenu: vi.fn(),
      openMoyuMenu: vi.fn(),
    },
    notice: vi.fn(),
    ...over,
  };
}

/** 只开「手柄」并在 full 的 5 槽上打补丁（默认表是参照物，别改它） */
function withFullSlots(slots: Partial<Record<HandleSlot, string | null>>): HandleBindings {
  return {
    dot: { enabled: false, slots: { ...DEFAULT_HANDLE_BINDINGS.dot.slots } },
    half: { enabled: false, slots: { ...DEFAULT_HANDLE_BINDINGS.half.slots } },
    full: { enabled: true, slots: { ...DEFAULT_HANDLE_BINDINGS.full.slots, ...slots } },
  };
}

const ALL_EMPTY: Record<HandleSlot, string | null> = {
  left: null,
  right: null,
  middle: null,
  leftDouble: null,
  rightDouble: null,
};

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

function render(bindings: HandleBindings, ctx: Ctx): void {
  act(() => {
    root.render(createElement(HandleCluster, { bindings, baseCtx: ctx }));
  });
}

function handles(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-handle]'));
}

function handleOf(form: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-handle="${form}"]`);
  if (!el) throw new Error(`找不到 ${form} 手柄`);
  return el;
}

/** 键盘激活 = `click` 且 `detail === 0`（鼠标点击恒 ≥ 1），浏览器就是这样派发的 */
function pressEnter(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  });
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('H-01 / H-02 / H-03：三形态的 DOM 形状', () => {
  it('h01_three_handles_in_registry_order', () => {
    render(DEFAULT_HANDLE_BINDINGS, makeCtx());
    /* 顺序 = HANDLE_FORMS（圆点 → 半手柄 → 手柄）。三个都是 `.pill` 的直接子项，
       中间没有 wrapper —— 包一层 div 会让 gap 只剩一处，宽度算式当场作废。 */
    expect(handles().map((el) => el.getAttribute('data-handle'))).toEqual([...HANDLE_FORMS]);
    for (const el of handles()) expect(el.parentElement).toBe(container);
  });

  it('h02_disabled_handles_stay_in_the_dom_but_hidden', () => {
    render(DEFAULT_HANDLE_BINDINGS, makeCtx());
    /* 节点**必须存在**：H-02 的判据是"该节点 offsetWidth === 0"，不渲染会让断言测不到。
       jsdom 不跑布局，所以 display:none 从样式源码里验。 */
    expect(handleOf('dot').getAttribute('data-enabled')).toBe('false');
    expect(handleOf('half').getAttribute('data-enabled')).toBe('false');
    expect(handleOf('full').getAttribute('data-enabled')).toBe('true');
    expect(read('styles/pill-handles.css')).toMatch(
      /\.pill__handle\[data-enabled='false'\]\s*\{[^}]*display:\s*none/,
    );
  });

  it('h03_all_three_glyphs_share_the_same_viewbox_and_stroke', () => {
    render(DEFAULT_HANDLE_BINDINGS, makeCtx());
    const svgs = handles().map((el) => {
      const svg = el.querySelector('svg');
      if (!svg) throw new Error('手柄没有 SVG');
      return svg;
    });
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 12 22');
      expect(svg.getAttribute('stroke-width')).toBe('2.5');
    }
    /* 圆点是实心（circle 自身不描边）；两个括号形态才走 path */
    const dot = svgs[0].querySelector('circle');
    expect(dot?.getAttribute('r')).toBe('3');
    expect(dot?.getAttribute('stroke')).toBe('none');
    expect(svgs[1].querySelector('path')).not.toBeNull();
    expect(svgs[2].querySelector('path')).not.toBeNull();
  });
});

describe('H-05 / H-06：可发现性与键盘', () => {
  it('h05_title_follows_the_binding', () => {
    render(DEFAULT_HANDLE_BINDINGS, makeCtx());
    expect(handleOf('full').getAttribute('title')).toContain('当前事项便利贴');
    expect(handleOf('full').getAttribute('title')).toContain('记录面板');

    render(withFullSlots({ left: 'patina.open', leftDouble: null }), makeCtx());
    const title = handleOf('full').getAttribute('title') ?? '';
    expect(title).toContain('唤出主界面');
    /* 旧文案必须消失：留着就是"改完看不出改没改" */
    expect(title).not.toContain('当前事项便利贴');
    expect(title).not.toContain('记录面板');
  });

  it('h06_keyboard_activation_fires_the_left_slot_once', () => {
    const ctx = makeCtx();
    render(withFullSlots({ left: 'note.list' }), ctx);
    pressEnter(handleOf('full'));
    expect(ctx.ui.openNotesList).toHaveBeenCalledTimes(1);
    /* 锚点由手柄在派发瞬间取（jsdom 里 rect 全零 → 0,0），关键是它必须被传进去 */
    expect(ctx.ui.openNotesList).toHaveBeenCalledWith({ x: -6, y: 4 });
  });

  it('h11_middle_click_dispatches_the_middle_slot', () => {
    const ctx = makeCtx();
    render(withFullSlots({ middle: 'note.list' }), ctx);
    act(() => {
      handleOf('full').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 }),
      );
      handleOf('full').dispatchEvent(
        new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
      );
    });
    expect(ctx.ui.openNotesList).toHaveBeenCalledTimes(1);
  });
});

describe('槽位语义：空槽静默，护栏拦截要提示（A-01 / A-07）', () => {
  it('a01_empty_slot_is_silent', () => {
    const ctx = makeCtx();
    render(withFullSlots(ALL_EMPTY), ctx);
    pressEnter(handleOf('full'));
    expect(ctx.timer.start).not.toHaveBeenCalled();
    expect(ctx.ui.openNotesList).not.toHaveBeenCalled();
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('a07_guard_blocks_with_notice', () => {
    const ctx = makeCtx({ status: 'running' });
    render(withFullSlots({ left: 'timer.start' }), ctx);
    pressEnter(handleOf('full'));
    expect(ctx.timer.start).not.toHaveBeenCalled();
    expect(ctx.notice).toHaveBeenCalledWith('已在计时中');
  });
});

/** 三次贝塞尔中点（t=0.5）相对起点的横向拱起量 + 纵向跨度 */
function bezier(d: string): { bulge: number; span: number } {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const [x0, , x1, , x2, , x3, y3] = n;
  return {
    bulge: (x0 + 3 * x1 + 3 * x2 + x3) / 8 - x0,
    span: Math.abs(y3 - n[1]),
  };
}

describe('W-07：半手柄的字形（拱起量，不是高度）', () => {
  it('w07_half_glyph_is_flatter_than_before_not_a_half_circle', () => {
    /* 用户口径（0.12.1 末）：「中间半手柄的弧度过大，应小一点，像最右边那条」。
       原 4.8px 高度里拱 1.65px，单位跨度拱起是长手柄的两倍 → 像半个圆圈。
       判据取**相对曲率**（拱起 / 跨度），它与形状语感同向，且不锁字面坐标：
       改回 7.8 → 0.34 > 长手柄 0.172 的 1.4 倍 → 红。 */
    render(DEFAULT_HANDLE_BINDINGS, makeCtx());
    const half = bezier(handleOf('half').querySelector('path')?.getAttribute('d') ?? '');
    const full = bezier(handleOf('full').querySelector('path')?.getAttribute('d') ?? '');
    const ratio = (g: { bulge: number; span: number }) => g.bulge / g.span;

    expect(half.span).toBeCloseTo(4.8, 2);
    expect(half.bulge).toBeCloseTo(1.05, 2);
    expect(ratio(half)).toBeLessThanOrEqual(ratio(full) * 1.4);
  });
});
