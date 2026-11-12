import { describe, expect, it } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

import {
  ITEM_TIMER_MAX_MINUTES,
  ITEM_TIMER_MIN_MINUTES,
  RECENT_ITEMS_DEFAULT,
  RECENT_ITEMS_MAX,
  RECENT_ITEMS_MIN,
} from "./itemPrefs.ts";

/**
 * [本轮] 「直接调用原功能」的**可验证兑现方式**：两侧常量同值。
 *
 * 用户的原话是「建议直接在该处调用原功能」。物理上办不到 ——
 * `scripts/check-layers.mjs` 的 L9 禁止分析窗（`src/features/**`）import 主窗
 * （`src/lib/**`）。所以做法是**在分析窗镜像一份等价纯函数**，并在这里读两侧源码
 * 比对字面量：常量漂一个数，这条就红（否则症状是静默的——宿主显示 1440、卡里显示别的，
 * 没有任何报错）。
 *
 * 为什么读源码而不是 import：import 就直接踩 L9 了；而 `readFileSync` 只读文本，不破门禁
 * （照 `hostIntentMirror.test.ts` 的先例）。
 */
function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

/** 从源码里抠 `export const NAME = 123;` 的数字；抠不到返回 `null`（哨兵会因此变红）。 */
function numericConst(source: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\b`).exec(source);
  return match ? Number(match[1]) : null;
}

const commonItemsSource = read("../../../../timing/lib/commonItems.ts");
const moyuSource = read("../../../../timing/lib/moyu.ts");

describe("itemPrefs 与宿主侧常量的镜像", () => {
  it("ipm01_timer_bounds_match_src_lib_commonItems", () => {
    expect(numericConst(commonItemsSource, "ITEM_TIMER_MIN_MINUTES")).toBe(ITEM_TIMER_MIN_MINUTES);
    expect(numericConst(commonItemsSource, "ITEM_TIMER_MAX_MINUTES")).toBe(ITEM_TIMER_MAX_MINUTES);
  });

  it("ipm02_recent_count_bounds_match_src_lib_moyu", () => {
    expect(numericConst(moyuSource, "RECENT_ITEMS_MIN")).toBe(RECENT_ITEMS_MIN);
    expect(numericConst(moyuSource, "RECENT_ITEMS_MAX")).toBe(RECENT_ITEMS_MAX);
    expect(numericConst(moyuSource, "RECENT_ITEMS_DEFAULT")).toBe(RECENT_ITEMS_DEFAULT);
  });

  /* 哨兵：正则写错 / 常量改名会让上面两条“两边都抠不到 → null === null”假绿。
     这里先确认宿主源码里真的存在这几个名字，且镜像侧的值不是 null。 */
  it("ipm03_the_host_sources_still_declare_those_names", () => {
    for (const name of ["ITEM_TIMER_MIN_MINUTES", "ITEM_TIMER_MAX_MINUTES"]) {
      expect(commonItemsSource).toContain(name);
    }
    for (const name of ["RECENT_ITEMS_MIN", "RECENT_ITEMS_MAX", "RECENT_ITEMS_DEFAULT"]) {
      expect(moyuSource).toContain(name);
    }
    expect(ITEM_TIMER_MAX_MINUTES).toBeGreaterThan(ITEM_TIMER_MIN_MINUTES);
    expect(RECENT_ITEMS_MAX).toBeGreaterThan(RECENT_ITEMS_MIN);
    expect(RECENT_ITEMS_DEFAULT).toBeGreaterThanOrEqual(RECENT_ITEMS_MIN);
    expect(RECENT_ITEMS_DEFAULT).toBeLessThanOrEqual(RECENT_ITEMS_MAX);
  });
});
