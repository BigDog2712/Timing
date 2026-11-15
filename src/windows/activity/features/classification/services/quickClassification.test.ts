import { describe, expect, it } from "vitest";

import { buildQuickAppOverride } from "./quickClassification.ts";
import {
  normalizeItemBindings,
  resolveCategorySet,
  serializeAppOverride,
  normalizeAppOverride,
} from "../../../shared/classification/appOverrideCodec.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";

/**
 * `buildQuickAppOverride` 是 override 的**唯一重建入口**：白名单式重建，`current` 里
 * 没被列进来的字段会被丢掉。本轮给它加了 `categories` / `itemBindings` 两组字段，
 * 于是最危险的回归就是——**只改一处，另一处被静默抹掉**：
 *
 *   「在应用设置弹窗里改了分类 → 保存 → 事项绑定整段没了」
 *
 * 这类事故不会报错、界面上也不会立刻看出来（下次打开弹窗才发现），所以必须由
 * 逐条断言钉住：**没被 patch 的那一组字段必须原样出现在结果里**。
 *
 * 另外钉住两条不变式（见 `buildQuickAppOverride` 的注释）：
 * ① `category` 恒等于 `categories[0]`；② 清空主分类 = 连集合一起清空。
 */

const base: AppOverride = {
  category: "development",
  categories: ["development", "design"],
  itemBindings: [{ itemId: 7, category: "design" }, { itemId: 9 }],
  displayName: "编辑器",
  color: "#315F9F",
  track: false,
  enabled: true,
  updatedAt: 1,
};

describe("buildQuickAppOverride · 字段透传", () => {
  it("qc01_changing_only_the_category_keeps_item_bindings_intact", () => {
    const next = buildQuickAppOverride(base, { categories: ["office", "development"] }, 2);
    expect(next?.itemBindings).toEqual([{ itemId: 7, category: "design" }, { itemId: 9 }]);
    expect(next?.categories).toEqual(["office", "development"]);
    expect(next?.category, "主分类必须等于集合首项").toBe("office");
    /* 其余既有字段一个都不许丢（白名单重建的老坑） */
    expect(next?.displayName).toBe("编辑器");
    expect(next?.color).toBe("#315F9F");
    expect(next?.track).toBe(false);
  });

  it("qc02_changing_only_the_item_bindings_keeps_the_category_set_intact", () => {
    const next = buildQuickAppOverride(base, { itemBindings: [{ itemId: 3, category: "development" }] }, 3);
    expect(next?.categories).toEqual(["development", "design"]);
    expect(next?.category).toBe("development");
    expect(next?.itemBindings).toEqual([{ itemId: 3, category: "development" }]);
  });

  it("qc03_changing_only_the_display_name_keeps_both_new_groups", () => {
    const next = buildQuickAppOverride(base, { displayName: " 新名字 " }, 4);
    expect(next?.displayName).toBe("新名字");
    expect(next?.categories).toEqual(["development", "design"]);
    expect(next?.itemBindings).toHaveLength(2);
  });

  it("qc04_a_single_category_patch_promotes_it_and_keeps_the_rest", () => {
    /* 快捷菜单（`QuickClassificationSurface`）走的就是这条路：改单分类。
       它不许把多选集合整段抹掉 —— 那是用户在同一天里用两条入口攒出来的数据。 */
    const next = buildQuickAppOverride(base, { category: "office" }, 5);
    expect(next?.category).toBe("office");
    expect(next?.categories).toEqual(["office", "development", "design"]);
  });

  it("qc05_clearing_the_category_clears_the_whole_set", () => {
    const next = buildQuickAppOverride(base, { category: null }, 6);
    expect(next?.category).toBeUndefined();
    expect(next?.categories).toBeUndefined();
    /* 清分类不该顺手把事项绑定也清掉：绑定本身与"归到哪个分类"是两件事 */
    expect(next?.itemBindings).toHaveLength(2);
    expect(next?.displayName).toBe("编辑器");
  });

  it("qc06_an_override_with_only_bindings_is_still_meaningful", () => {
    const next = buildQuickAppOverride(null, { itemBindings: [{ itemId: 11 }] }, 7);
    expect(next).not.toBeNull();
    expect(next?.itemBindings).toEqual([{ itemId: 11 }]);
    expect(next?.category).toBeUndefined();
  });

  it("qc07_an_empty_patch_on_an_empty_override_still_yields_null", () => {
    expect(buildQuickAppOverride(null, {}, 8)).toBeNull();
  });
});

describe("override 编解码 · 新字段往返", () => {
  it("qc08_serialize_writes_categories_and_bindings_and_parse_reads_them_back", () => {
    const raw = serializeAppOverride({
      category: "development",
      categories: ["development", "design"],
      itemBindings: [{ itemId: 7, category: "design" }, { itemId: 9 }],
    });
    const parsed = normalizeAppOverride(JSON.parse(raw) as AppOverride);
    expect(parsed?.category).toBe("development");
    expect(parsed?.categories).toEqual(["development", "design"]);
    expect(parsed?.itemBindings).toEqual([{ itemId: 7, category: "design" }, { itemId: 9 }]);
  });

  it("qc09_legacy_rows_without_categories_still_read_as_a_one_element_set", () => {
    /* 老数据零迁移：只有 `category` 的行读出来，集合就是 `[category]`。 */
    const parsed = normalizeAppOverride({ category: "office", enabled: true });
    expect(parsed?.category).toBe("office");
    expect(parsed?.categories).toEqual(["office"]);
    expect(resolveCategorySet(parsed)).toEqual(["office"]);
  });

  it("qc10_other_never_enters_the_set_and_dirty_ids_are_dropped", () => {
    expect(normalizeItemBindings([
      { itemId: 0 },
      { itemId: -3 },
      { itemId: 4.5 },
      { itemId: 5 },
      { itemId: 5, category: "development" },
    ])).toEqual([{ itemId: 5 }]);
    /* `other` = 未分类：它能留在 `category` 上（旧行为不变），但**不许**进多选集合 */
    const otherOnly = normalizeAppOverride({ category: "other", categories: ["other"], enabled: true });
    expect(otherOnly?.category).toBe("other");
    expect(otherOnly?.categories).toBeUndefined();
  });
});

describe("resolveCategorySet · 读侧唯一入口", () => {
  it("qc11_deleted_custom_categories_are_filtered_out", () => {
    const override: AppOverride = { category: "custom:a", categories: ["custom:a", "development"] };
    expect(resolveCategorySet(override, ["custom:a"])).toEqual(["development"]);
  });

  it("qc12_when_every_category_is_deleted_it_falls_back_to_the_primary", () => {
    /* 过滤后为空 → 回落到 `category`；`category` 若也在删除名单里 → 空集合（= 未分类） */
    expect(resolveCategorySet({ category: "development", categories: ["development", "design"] }, ["development"])).toEqual(["design"]);
    expect(resolveCategorySet({ category: "custom:a", categories: ["custom:a"] }, ["custom:a"])).toEqual([]);
  });
});
