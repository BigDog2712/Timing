import { describe, expect, it } from "vitest";

import {
  assignDraftItemCategory,
  buildDraftAppOverride,
  collectCategoryUsage,
  createAppEditDraft,
  isDraftDirty,
  keepItemCategoriesWithin,
  promoteDraftCategory,
  resolveItemBindingsMirrorPayload,
  resolveSingleBindingClear,
  toggleDraftCategory,
  toggleDraftItem,
  withFullItemBindingSet,
  withSingleItemBinding,
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

/**
 * [0.13 fix · P0-2] 镜像载荷的判据。
 *
 * 这层守的是「界面显示已绑定、库里其实没有了」：本弹窗的草稿只看得到
 * `__app_override::.itemBindings`，看不到排行卡那份 1:1 的 `__app_item_binding::<exe>`。
 * 把"这份 override 没有 `itemBindings`"当成"用户清空了"去发 `itemIds: []`，
 * 执行端的三向 diff 就会把宿主 `item_app` 里那条 1:1 绑定删掉 —— 下次开游戏仍然不计时。
 *
 * 变异自证：把 `heldFullSet` 改成 `true`（即永远发），`ad16` 立刻红。
 */
describe("resolveItemBindingsMirrorPayload", () => {
  it("ad16_原配置没有_itemBindings_时不发镜像_别把排行卡的_1比1_绑定删掉", () => {
    /* 用户只在排行卡上绑过：override 里只有分类与别名，没有 itemBindings */
    const before: AppOverride = { category: "development", displayName: "旧名", enabled: true, updatedAt: 1 };
    /* 他这次只是改了个名字，`buildQuickAppOverride` 照旧不产出 itemBindings */
    const after: AppOverride = { category: "development", displayName: "新名", enabled: true, updatedAt: 2 };

    expect(resolveItemBindingsMirrorPayload(before, after)).toBeNull();
    expect(resolveItemBindingsMirrorPayload(null, after)).toBeNull();
    expect(resolveItemBindingsMirrorPayload(null, null)).toBeNull();
  });

  it("ad17_有_itemBindings_时发全集_并在_track为false_时降成仅观察", () => {
    const after: AppOverride = {
      itemBindings: [{ itemId: 7 }, { itemId: 9 }],
      enabled: true,
      updatedAt: 2,
    };
    expect(resolveItemBindingsMirrorPayload(null, after)).toEqual({ itemIds: [7, 9], track: 1 });
    expect(resolveItemBindingsMirrorPayload(null, { ...after, track: false }))
      .toEqual({ itemIds: [7, 9], track: 0 });
  });

  it("ad18_原先有_itemBindings_这次被清空_发空全集_那是用户显式的解绑", () => {
    const before: AppOverride = {
      itemBindings: [{ itemId: 7 }],
      enabled: true,
      updatedAt: 1,
    };
    const cleared: AppOverride = { category: "development", enabled: true, updatedAt: 2 };

    /* 空数组是显式删除信号：执行端据此 unbind，而不是"缺字段就当作没这回事" */
    expect(resolveItemBindingsMirrorPayload(before, cleared)).toEqual({ itemIds: [], track: 1 });
    /* 显式拿到空数组（调用方自己知道全集）同样按删除处理 */
    expect(resolveItemBindingsMirrorPayload(before, { ...before, itemBindings: [] }))
      .toEqual({ itemIds: [], track: 1 });
  });
});

/**
 * [0.13 fix · P0-3] 「我解绑了，重启又被补回来」。
 *
 * 应用 → 事项的绑定有两份配置：本弹窗的 `__app_override::.itemBindings[]`，和排行卡
 * 「绑定事项」的 1:1 `__app_item_binding::<exe>`。只读 override 的后果是双向的：
 * 用户**看不到** 1:1 那一条（取消无从表达），而且保存后 KV 还留着 → 下次开机补镜像
 * 把它原样补回 `item_app` → 用户认为"开关坏了"。
 *
 * 变异自证：把 `withSingleItemBinding` / `withFullItemBindingSet` 变成恒等 → ad19 红
 * （草稿里看不到 5、镜像被判成"不持有全集"）；把 `resolveSingleBindingClear` 恒返回
 * null（不清 KV）→ ad19 红。
 */
describe("1:1 绑定并进全集（P0-3：解绑不许被启动补镜像补回）", () => {
  it("ad19_override 没有 itemBindings、1:1 指向 5、用户取消 5：发空全集且要清 1:1 的 KV", () => {
    /* 只有排行卡绑过：override 里只有分类，没有 itemBindings */
    const current: AppOverride = { category: "development", enabled: true, updatedAt: 1 };
    const single = 5;
    const fullCurrent = withFullItemBindingSet(current, single);

    /* ① 打开弹窗：草稿里必须**看得到** 5（否则用户根本取消不了它） */
    const opened = withSingleItemBinding(createAppEditDraft(current), single);
    expect(opened.itemBindings.map((binding) => binding.itemId)).toEqual([5]);
    /* 只并这一维：分类原样，不许顺手改别的 */
    expect(opened.categories).toEqual(["development"]);

    /* ② 用户取消 5 → 保存后的 override 里没有 itemBindings，但全集基线里有 */
    const next = buildDraftAppOverride(fullCurrent, { categories: opened.categories, itemBindings: [] });
    expect(resolveItemBindingsMirrorPayload(fullCurrent, next))
      .toEqual({ itemIds: [], track: 1 });
    /* ③ KV 必须一起清：否则启动补镜像会把 item_app 那行原样补回来 */
    expect(resolveSingleBindingClear(single, next)).toBe(5);
  });

  it("ad20_override 有 5 与 7、1:1 指向 5、用户只取消 7：1:1 的 KV 不许动", () => {
    const current: AppOverride = {
      itemBindings: [{ itemId: 5 }, { itemId: 7 }],
      enabled: true,
      updatedAt: 1,
    };
    const single = 5;
    /* 5 已在 override 里 → 合并是恒等（不重复、也不改顺序） */
    expect(withFullItemBindingSet(current, single)).toBe(current);

    const next = buildDraftAppOverride(current, { categories: [], itemBindings: [{ itemId: 5 }] });
    expect(resolveItemBindingsMirrorPayload(current, next)).toEqual({ itemIds: [5], track: 1 });
    /* 1:1 指的 5 还在全集里 → 清它就是删了用户没取消的绑定 */
    expect(resolveSingleBindingClear(single, next)).toBeNull();
  });

  it("ad21_1:1 指向的事项不在 override 里：并集成全集，取消它才算真取消", () => {
    const current: AppOverride = {
      itemBindings: [{ itemId: 7 }],
      enabled: true,
      updatedAt: 1,
    };
    /* 1:1 是 5，override 只有 7 → 真全集是 [7, 5] */
    expect(withFullItemBindingSet(current, 5)?.itemBindings).toEqual([
      { itemId: 7 },
      { itemId: 5 },
    ]);
    /* 读失败（undefined）/ 没有绑定（null）都不许往全集里塞东西 */
    expect(withFullItemBindingSet(current, null)).toBe(current);
    expect(withFullItemBindingSet(current, undefined)).toBe(current);
  });
});
