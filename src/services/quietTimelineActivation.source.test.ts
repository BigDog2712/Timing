/**
 * Timing — `QuietTimelineSegment`「可点」是**可选升级**的机器判据（P0-05 a11y 回归）
 * -----------------------------------------------------------------------------
 * `onActivate` 本轮才加到共享组件上（历史页「活动段 → 在 Timing 计这件事」）。风险不在
 * 新用法，而在**既有用法**：不传 `onActivate` 的三处（总览轨展开弹窗 / 目的地详情页 /
 * 泳道自渲染）必须保持「纯展示 `<span>`」。一旦默认挂上 `role="button"` 或 `tabIndex=0`，
 * 屏幕阅读器会把一整天的几百个色块念成几百个「按钮」，Tab 要按几百次才走得出时间线。
 * 这种回归肉眼看不见，只能钉住。
 *
 * ## 为什么是**源码哨兵**而不是渲染测试
 *
 * 两个硬约束把渲染测试挡在门外：
 *   ① L9 双窗隔离（`scripts/check-layers.mjs`）：主窗（components/hooks/lib/mocks/services/
 *      stores/styles/types）与分析窗（app/features/platform/shared）不得互相 import ——
 *      `QuietTimelineSegment` 住在 `src/shared/`，所以**主窗侧任何文件都不能 import 它**；
 *      而分析窗侧那四个根全是 vendored 源码（`scripts/check-vendored-diff.mjs`），
 *      新文件必须往 allowlist 登记。
 *   ② 本仓已有同一口径的先例：`src/services/hostTimerFormula.source.test.ts` 守的也是
 *      vendored 的 `hostTimerGateway.ts`，同样住在非 vendored 的 `services/` 里，靠文本。
 *
 * 所以这里钉的是**三个条件表达式必须原样存在**，并且**裸 `role="button"` / 裸 `tabIndex={0}`
 * 必须不存在**——后者正是最可能被顺手写出的形态（「反正都是按钮」）。
 * 变异自证：把 `role={onActivate === undefined ? undefined : "button"}` 改成 `role="button"`
 * （`tabIndex` 同样改成 `0`）→ 本文件 2 条用例变红。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 去注释：注释里正当地写着 `role="button"`（说明文字），拿注释当证据会让判据自我满足。 */
function readCode(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SEGMENT = readCode('../shared/components/QuietTimelineTrack.tsx');

describe('不传 onActivate 时，段仍是纯展示 span（既有三处用法零回归）', () => {
  it('activation_props_are_ternary_on_onActivate_not_unconditional', () => {
    /* 三个属性必须都是「没传就 undefined」的三元。写成裸值 = 既有用法被升级成按钮。 */
    expect(SEGMENT).toContain('role={onActivate === undefined ? undefined : "button"}');
    expect(SEGMENT).toContain('tabIndex={onActivate === undefined ? undefined : 0}');
    expect(SEGMENT).toContain('data-timeline-activatable={onActivate === undefined ? undefined : "true"}');
  });

  it('no_bare_button_semantics_sneaks_in', () => {
    /* 变异靶子：`role="button"` / `tabIndex={0}` 裸挂就是本判据要挡的那种「顺手改」。 */
    expect(SEGMENT, '裸 role="button" 会让不可点的段也变成按钮')
      .not.toMatch(/role="button"/);
    expect(SEGMENT, '裸 tabIndex={0} 会把几百个色块塞进 Tab 序')
      .not.toMatch(/tabIndex=\{0\}/);
  });

  it('click_and_keyboard_handlers_derive_from_the_same_optional_prop', () => {
    /* 处理器也必须跟着可选 prop 走：`onClick={onActivate}`（undefined 即不挂），
       键盘处理器由 `onActivate === undefined` 决定是否构造。 */
    expect(SEGMENT).toContain('onClick={onActivate}');
    expect(SEGMENT).toContain('const handleKeyDown = onActivate === undefined');
    expect(SEGMENT).toContain('onKeyDown={handleKeyDown}');
    expect(SEGMENT, 'onActivate 必须是可选 prop（默认 undefined = 纯展示）')
      .toContain('onActivate?: () => void;');
  });

  it('keyboard_activation_is_enter_and_space_only', () => {
    /* 全键响应会把方向键/翻页键也吃掉，时间线上的滚动就没了。 */
    expect(SEGMENT).toContain('if (event.key !== "Enter" && event.key !== " ") return;');
    expect(SEGMENT).toContain('event.preventDefault();');
  });
});
