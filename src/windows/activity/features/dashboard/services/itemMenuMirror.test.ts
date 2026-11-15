import { describe, expect, it } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

import { clampItemMinutes } from "./itemPrefs.ts";

/**
 * §3.1 C：默认时长的"留空"语义在**两窗各写一份**，必须镜像。
 *
 *   · 药丸侧 `src/windows/timing/components/menu/ItemsPrefsMenu.tsx` 的 `readMinutes()`；
 *   · 分析窗 `features/dashboard/services/itemPrefs.ts` 的 `clampItemMinutes()`。
 *
 * L9 禁止两窗互相 import，所以这条契约只能靠"两边都写对 + 这份判据钉住"。
 * 漂移的症状是静默的：药丸把留空当成 0 分钟（回正计时），分析窗弹层把留空当成
 * 清默认时长 —— 两个入口对同一个输入框给出两种结果，用户只会觉得"时灵时不灵"。
 *
 * 钉法：① 运行时判据（`clampItemMinutes` 的行为）；② 源码判据（药丸侧那条
 * `if (raw === '') return null;` 必须在）。源码判据是变异靶点：把药丸侧的
 * 空串分支改成 `return 0`，这条立刻红。
 */
function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const pillMenu = read("../../../../timing/components/menu/ItemsPrefsMenu.tsx");

describe("默认时长「留空」语义 · 两窗镜像（§3.1 C）", () => {
  it("im01_empty_string_means_count_up_on_the_dashboard_side", () => {
    /* 留空 = 正计时（null），不是 0；数字超界钳到 1..1440；非数字 = 没填 */
    expect(clampItemMinutes("")).toBeNull();
    expect(clampItemMinutes("   ")).toBeNull();
    expect(clampItemMinutes("abc")).toBeNull();
    expect(clampItemMinutes("25")).toBe(25);
    expect(clampItemMinutes("0")).toBe(1);
    expect(clampItemMinutes("2000")).toBe(1440);
    expect(clampItemMinutes(null)).toBeNull();
  });

  it("im02_the_pill_side_keeps_the_empty_string_branch_returning_null", () => {
    /* 药丸侧 `readMinutes()` 的第一条分支：空串 → null（正计时）。
       改成 `return 0` 或删掉这条分支，判据立刻红。 */
    expect(pillMenu).toMatch(/if \(raw === ''\) return null;/);
    /* 两侧同一把钳：1..1440（药丸侧用 ITEM_TIMER_* 常量，分析窗侧在 itemPrefs.ts） */
    expect(pillMenu).toMatch(/ITEM_TIMER_MAX_MINUTES/);
    expect(pillMenu).toMatch(/ITEM_TIMER_MIN_MINUTES/);
  });
});
