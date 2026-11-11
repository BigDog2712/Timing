/**
 * 药丸手柄区的单测（H-01 / H-02 / H-03 / H-05 / H-06 + 宽度算式 W-01…W-05）
 * -----------------------------------------------------------------------------
 * jsdom **不做布局**：`offsetWidth` 恒为 0、rect 全零、外部 CSS 不参与计算。所以 H-02 的
 * `offsetWidth === 0` 与 §6.1 的宽度算式都不可能靠"量 DOM"验证。替代口径两条，都能红：
 *   ① 结构 + 属性：顺序、`data-enabled`、三种 SVG 同 viewBox；
 *   ② 读**样式源码**（真实文件）把 token 代入 §6.1 算式，断言三手柄全开时 name ≥154、总宽 ≤320。
 *      把 `--pill-w-max` 改回 288 → name 只剩 142 → `w04` 立刻红，这就是那条反证。
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

function token(css: string, name: string): number {
  const match = new RegExp(`--${name}:\\s*([0-9.]+)px`).exec(css);
  if (!match) throw new Error(`tokens 里找不到 --${name}`);
  return Number(match[1]);
}

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

describe('几何：token 与宽度算式（W-01…W-05 / R-03）', () => {
  const primitives = read('styles/tokens/01-primitives.css');
  const surfaces = read('styles/surfaces.css');
  const overlays = read('styles/overlays.css');

  it('w01_grip_width_is_12', () => {
    expect(token(primitives, 'grip-w')).toBe(12);
    expect(token(primitives, 'grip-hit-w')).toBe(12);
  });

  it('w02_pill_max_width_is_320_and_undo_stays_at_288', () => {
    expect(token(primitives, 'pill-w-max')).toBe(320);
    expect(token(primitives, 'undo-w-max')).toBe(288);
    /* 撤销条是唯一必须换变量的消费点；`--pill-w-max` 的消费点只剩 `.pill` 一处 */
    expect(overlays).toContain('max-width: var(--undo-w-max)');
    expect(surfaces).toContain('max-width: var(--pill-w-max)');
  });

  it('r03_name_to_first_handle_gap_is_still_4px', () => {
    /* 删掉「今天」图标位之后，4px 净间距**只**靠这条 margin-left。再加一次就变 0（R-03）。
       全仓 grep「今天图标位」= 0（R-01）：它的两个动作已经变成 today.panel / today.digest。 */
    expect(surfaces).toMatch(/\.pill__handle\s*\{\s*margin-left:\s*calc\(-1 \* var\(--space-1\)\)/);
    expect(surfaces.match(/margin-left:\s*calc\(-1 \* var\(--space-1\)\)/g)).toHaveLength(1);
  });

  it('w04_name_width_never_below_154', () => {
    /* §6.1 的算式（数值全部从样式源码里读，不抄常量）：
         固定 = pad-l + pad-r + border(1+1) + ring + gap(环↔数字) + timer
              + (name 前净间距 = gap − margin) + 3 × 每手柄净占
         每手柄净占 = gap − margin + 命中宽 */
    const gap = token(primitives, 'space-2');
    const margin = token(primitives, 'space-1');
    const perHandle = gap - margin + token(primitives, 'grip-w');
    const timerWidth = 53; /* 既有 `.timer-digits` 定宽（surfaces.css:147），本轮不动 */
    const fixed =
      token(primitives, 'pill-pad-l') +
      token(primitives, 'pill-pad-r') +
      2 +
      token(primitives, 'ring-size') +
      gap +
      timerWidth +
      (gap - margin) +
      3 * perHandle;

    const pillMax = token(primitives, 'pill-w-max');
    const nameWidth = Math.min(pillMax - fixed, token(primitives, 'task-w-max'));

    expect(perHandle).toBe(16);
    expect(fixed).toBe(146);
    /* 反证：`--pill-w-max` 回落到 288 → name 只剩 142 < 154 → 本条红（W-04） */
    expect(nameWidth).toBeGreaterThanOrEqual(154);
    expect(nameWidth).toBe(164);
    /* 三手柄全开的总宽 = 310，且必须仍 ≤ 上限 */
    expect(fixed + nameWidth).toBe(310);
    expect(fixed + nameWidth).toBeLessThanOrEqual(pillMax);
  });

  it('w05_pill_max_width_leaves_headroom_for_the_frame', () => {
    /* 药丸窗口 384 - 2 × 每手柄净占 = 352 是"还能塞三个手柄"的物理上限；320 ≤ 352。
       变异：把 320 改 360 → 本条红。 */
    const gap = token(primitives, 'space-2');
    const margin = token(primitives, 'space-1');
    const perHandle = gap - margin + token(primitives, 'grip-w');
    expect(token(primitives, 'pill-w-max')).toBeLessThanOrEqual(384 - 2 * perHandle);
  });
});
