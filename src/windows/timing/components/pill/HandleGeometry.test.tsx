/**
 * 药丸手柄区的**几何与宽度算式**判据（W-01…W-06 / R-03）
 * -----------------------------------------------------------------------------
 * jsdom 不做布局：`offsetWidth` 恒为 0、外部 CSS 不参与计算，所以 §6.1 的宽度算式不可能
 * 靠"量 DOM"验证。这里改读**样式源码**（真实文件）把 token 代入算式，断言三手柄全开时
 * name ≥154、总宽 ≤320，并钉住「手柄之间」那条兄弟规则真的存在。
 *
 * 为什么与 `HandleCluster.test.tsx` 分开（0.12.1 末）：那个文件已到 300 行硬上限。
 * 切口是"行为 vs 几何"——DOM 形状 / 键鼠派发 / 槽位语义留在那边，这里只读样式与 token。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from 'node:path';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from 'node:url';

/** `src/components/pill/` → `src/` */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

function token(css: string, name: string): number {
  const match = new RegExp(`--${name}:\\s*([0-9.]+)px`).exec(css);
  if (!match) throw new Error(`tokens 里找不到 --${name}`);
  return Number(match[1]);
}

const primitives = read('styles/tokens/01-primitives.css');
const surfaces = read('styles/surfaces.css');
const overlays = read('styles/overlays.css');

describe('几何：token 与宽度算式（W-01…W-06 / R-03）', () => {
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
              + (name 前净间距 = gap − margin) + 第一个手柄净占 + 2 × 其后每个净占
         第一个手柄净占 = gap − margin + 命中宽
         其后的手柄净占 = gap − 2×margin + 命中宽   ← pill-handles.css 的兄弟规则再抵一次 */
    const gap = token(primitives, 'space-2');
    const margin = token(primitives, 'space-1');
    const grip = token(primitives, 'grip-w');
    const perFirst = gap - margin + grip;
    const perRest = gap - 2 * margin + grip;
    const timerWidth = 53; /* 既有 `.timer-digits` 定宽（surfaces.css:147），本轮不动 */
    const fixed =
      token(primitives, 'pill-pad-l') +
      token(primitives, 'pill-pad-r') +
      2 +
      token(primitives, 'ring-size') +
      gap +
      timerWidth +
      (gap - margin) +
      perFirst +
      2 * perRest;

    const pillMax = token(primitives, 'pill-w-max');
    const nameWidth = Math.min(pillMax - fixed, token(primitives, 'task-w-max'));

    expect(perFirst).toBe(16);
    expect(perRest).toBe(12);
    expect(fixed).toBe(138);
    /* 反证：`--pill-w-max` 回落到 288 → name 只剩 142 < 154 → 本条红（W-04） */
    expect(nameWidth).toBeGreaterThanOrEqual(154);
    expect(nameWidth).toBe(164);
    /* 三手柄全开的总宽 = 302，且必须仍 ≤ 上限 */
    expect(fixed + nameWidth).toBe(302);
    expect(fixed + nameWidth).toBeLessThanOrEqual(pillMax);
  });

  it('w06_handle_to_handle_pitch_is_tightened_in_the_stylesheet', () => {
    /* 钉**接线**不是钉名字：上面那条算式里的 perRest 是从 token 推的，把 pill-handles.css
       里那条兄弟规则删掉，算式照样自洽（凭空少 8px 没人发现）。所以这里直接读样式源码，
       要求「已启用的手柄 ~ 其后的手柄」真的存在、且真的抵的是 2×--space-1。
       用 `~` 而非 `+` 是刻意的：手柄能单独开关，`+` 会在「前一个兄弟被 display:none」时漏掉。 */
    const handles = read('styles/pill-handles.css');
    expect(handles).toMatch(
      /\.pill__handle:not\(\[data-enabled='false'\]\) ~ \.pill__handle\s*\{[^}]*margin-left:\s*calc\(-2 \* var\(--space-1\)\)/,
    );
    /* 反向钉子：基础 margin（第一个手柄的 4px）不许跟着一起变宽 */
    expect(surfaces).toMatch(/\.pill__handle\s*\{\s*margin-left:\s*calc\(-1 \* var\(--space-1\)\)/);
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
