import { describe, expect, it } from "vitest";

import {
  assignDraftItemCategory,
  buildDraftAppOverride,
  collectCategoryUsage,
  createAppEditDraft,
  isDraftDirty,
  keepItemCategoriesWithin,
  promoteDraftCategory,
  toggleDraftCategory,
  toggleDraftItem,
  type AppEditDraft,
} from "./appEditDraft.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";

/**
 * 「应用设置」草稿模型的判据。
 *
 * 钉的是三件"点了没反应 / 数据悄悄丢"的事：
 *  ① 取消勾选一个分类 → 指着它的事项回落成"跟随主分类"（否则读侧会看到一个不在集合里的
 *     分类，下一次 bootstrap 就把它**复活**成选项）；
 *  ② 草稿写回 override 时 `category` 与 `categories` 始终一致（不变式）；
 *  ③ 取用量只数 override 集合里的成员，不额外查库。
 */

const persisted: AppOverride = {
  category: "development",
  categories: ["development", "design"],
  itemBindings: [{ itemId: 7, category: "design" }, { itemId: 9 }],
  displayName: "编辑器",
  color: "#315F9F",
  track: false,
  enabled: true,
  updatedAt: 1,
};

describe("createAppEditDraft", () => {
  it("ad01_reads_the_set_and_filters_deleted_categories", () => {
    expect(createAppEditDraft(persisted)).toEqual({
      categories: ["development", "design"],
      itemBindings: [{ itemId: 7, category: "design" }, { itemId: 9 }],
    });
    /* 自定义分类被删掉之后不许再出现在勾选里 */
    expect(createAppEditDraft(
      { category: "custom:gone", categories: ["custom:gone", "design"] },
      ["custom:gone"],
    ).categories).toEqual(["design"]);
  });

  it("ad02_a_legacy_override_reads_as_a_one_element_set", () => {
    expect(createAppEditDraft({ category: "office" }).categories).toEqual(["office"]);
  });

  it("ad03_a_missing_override_is_an_empty_draft", () => {
    expect(createAppEditDraft(null)).toEqual({ categories: [], itemBindings: [] });
  });
});

describe("勾选联动", () => {
  const draft: AppEditDraft = {
    categories: ["development", "design"],
    itemBindings: [{ itemId: 7, category: "design" }, { itemId: 9 }],
  };

  it("ad04_unchecking_a_category_resets_the_items_that_pointed_at_it", () => {
    const next = toggleDraftCategory(draft, "design");
    expect(next.categories).toEqual(["development"]);
    expect(next.itemBindings).toEqual([{ itemId: 7 }, { itemId: 9 }]);
  });

  it("ad05_unchecking_the_primary_promotes_the_next_one", () => {
    /* 取消主分类 = 次位自动接班（草稿里 `[0]` 就是主分类，没有第二个字段要同步） */
    const next = toggleDraftCategory(draft, "development");
    expect(next.categories).toEqual(["design"]);
    expect(next.categories[0]).toBe("design");
  });

  it("ad06_promoting_moves_the_category_to_the_front_without_duplicating", () => {
    const next = promoteDraftCategory(draft, "design");
    expect(next.categories).toEqual(["design", "development"]);
    /* 未勾选的分类被提为主分类 → 先补上，不许出现两份 */
    expect(promoteDraftCategory(draft, "office").categories).toEqual(["office", "development", "design"]);
  });

  it("ad07_toggling_an_item_keeps_the_category_assignment_when_rebinding", () => {
    const off = toggleDraftItem(draft, 7);
    expect(off.itemBindings).toEqual([{ itemId: 9 }]);
    const on = toggleDraftItem(off, 7);
    expect(on.itemBindings).toEqual([{ itemId: 9 }, { itemId: 7 }]);
  });

  it("ad08_assigning_a_category_undefined_means_follow_primary", () => {
    expect(assignDraftItemCategory(draft, 9, "design").itemBindings)
      .toEqual([{ itemId: 7, category: "design" }, { itemId: 9, category: "design" }]);
    expect(assignDraftItemCategory(draft, 7, undefined).itemBindings)
      .toEqual([{ itemId: 7 }, { itemId: 9 }]);
  });

  it("ad09_keep_within_never_leaves_an_orphan_category", () => {
    expect(keepItemCategoriesWithin(["development"], [{ itemId: 7, category: "design" }]).itemBindings)
      .toEqual([{ itemId: 7 }]);
  });
});

describe("写回", () => {
  it("ad10_the_primary_category_always_equals_the_first_set_member", () => {
    const draft: AppEditDraft = { categories: ["design", "development"], itemBindings: [] };
    const next = buildDraftAppOverride(persisted, draft, 2);
    expect(next?.category).toBe("design");
    expect(next?.categories).toEqual(["design", "development"]);
  });

  it("ad11_unchecking_every_category_really_clears_it", () => {
    /* 这条是"只传集合"的变异靶点：`buildQuickAppOverride` 会用 `current.category` 回落，
       所以草稿必须把 `category: null` 一起传下去，否则取消干净之后又会冒回来。 */
    const next = buildDraftAppOverride(persisted, { categories: [], itemBindings: [] }, 3);
    expect(next?.category).toBeUndefined();
    expect(next?.categories).toBeUndefined();
    /* 别名 / 颜色 / 不追踪标题这些既有设置一个都不许被这次保存带走 */
    expect(next?.displayName).toBe("编辑器");
    expect(next?.color).toBe("#315F9F");
    expect(next?.track).toBe(false);
  });

  it("ad12_saving_the_items_keeps_the_category_set", () => {
    const draft: AppEditDraft = {
      categories: ["development", "design"],
      itemBindings: [{ itemId: 11, category: "development" }],
    };
    const next = buildDraftAppOverride(persisted, draft, 4);
    expect(next?.categories).toEqual(["development", "design"]);
    expect(next?.itemBindings).toEqual([{ itemId: 11, category: "development" }]);
  });
});

describe("isDraftDirty", () => {
  it("ad13_an_untouched_draft_is_not_dirty", () => {
    expect(isDraftDirty(createAppEditDraft(persisted), persisted)).toBe(false);
  });

  it("ad14_any_real_change_marks_it_dirty", () => {
    const draft = toggleDraftItem(createAppEditDraft(persisted), 12);
    expect(isDraftDirty(draft, persisted)).toBe(true);
    expect(isDraftDirty(toggleDraftCategory(createAppEditDraft(persisted), "office"), persisted)).toBe(true);
  });
});

describe("collectCategoryUsage", () => {
  it("ad15_counts_apps_and_web_domains_per_category", () => {
    /* 网页域名一侧只有单一分类（`WebDomainOverride` 没有多选集合 —— 那个字段在
       本轮复核后按"无 UI 也无写盘路径"删掉了），所以它一个域名只记一次。 */
    const usage = collectCategoryUsage(
      {
        "a.exe": { category: "development", categories: ["development", "design"] },
        "b.exe": { category: "development" },
        "c.exe": { category: "office" },
      },
      {
        "example.com": { category: "design" },
        "other.com": { category: "office" },
      },
    );
    /* development: 2 个应用；design: 1 应用 + 1 域名；office: 1 应用 + 1 域名 */
    expect(usage).toEqual({ development: 2, design: 2, office: 2 });
  });
});
