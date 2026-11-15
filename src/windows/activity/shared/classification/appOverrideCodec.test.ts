import { describe, expect, it } from "vitest";

import {
  normalizeAppOverride,
  normalizeCategorySet,
  normalizeItemBindings,
  parseAppOverride,
  resolveCategorySet,
  serializeAppOverride,
} from "./appOverrideCodec.ts";
import { buildQuickAppOverride } from "../../features/classification/services/quickClassification.ts";
import type { AppOverride } from "./processMapper.ts";

/**
 * override 编解码的**脏数据 / 兼容**判据（[QA 本轮独立复核]）。
 *
 * 与 `quickClassification.test.ts`（qc08–qc12）的分工：那边钉"新字段往返 + 已删分类"，
 * 这边钉**真实存量数据会长成什么样**——老行只有 `category`、手改过的 JSON 里混着
 * `other` / 非法 token / 重复 itemId / 负数 id。这些数据不会报错，只会让某一处界面
 * 少显示一行或者多画一个分类，所以只能一条条钉住。
 */
describe("老数据兼容（零迁移）", () => {
  it("ac01_a_legacy_storage_row_without_the_new_keys_reads_as_a_one_element_set", () => {
    /* 真实存量：Rust `StoredAppOverride` 序列化出来的形状（没有 categories / itemBindings） */
    const raw = JSON.stringify({
      category: "office",
      displayName: "Word",
      color: "#315F9F",
      track: true,
      captureTitle: false,
      enabled: true,
      updatedAt: 1700000000000,
    });
    const parsed = parseAppOverride(raw);
    expect(parsed?.category).toBe("office");
    expect(parsed?.categories).toEqual(["office"]);
    expect(resolveCategorySet(parsed)).toEqual(["office"]);
    /* 老字段一个都不许在归一里被吃掉 */
    expect(parsed?.displayName).toBe("Word");
    expect(parsed?.captureTitle).toBe(false);
  });

  it("ac02_an_unparsable_row_degrades_to_null_instead_of_throwing", () => {
    expect(parseAppOverride("")).toBeNull();
    expect(parseAppOverride("   ")).toBeNull();
    expect(parseAppOverride("{not json")).toBeNull();
    /* `{"enabled":false}` = 这条 override 被停用 → 视作没有 */
    expect(normalizeAppOverride({ enabled: false, category: "office" })).toBeNull();
  });
});

describe("已删除 / 非法分类的过滤", () => {
  it("ac03_a_deleted_custom_category_is_filtered_and_the_primary_takes_over", () => {
    /* 集合里只剩一个「已删」+ 主分类仍然有效 → 过滤后为空 → 回落到 `category` */
    expect(resolveCategorySet(
      { category: "development", categories: ["custom:gone"] },
      ["custom:gone"],
    )).toEqual(["development"]);

    /* 混合：删掉自定义那一个，剩下的有效项原样保留 */
    expect(resolveCategorySet(
      { category: "development", categories: ["custom:gone", "design"] },
      ["custom:gone"],
    )).toEqual(["design"]);

    /* 主分类自己也被删 → 空集合（= 未分类），不许回落到 `other` */
    expect(resolveCategorySet(
      { category: "custom:gone", categories: ["custom:gone"] },
      ["custom:gone"],
    )).toEqual([]);
  });

  it("ac04_unknown_tokens_never_enter_the_set", () => {
    /* 手改过的 JSON / 老版本写进去的脏 token：既不是内置名也不是 `custom:` 前缀。
       fallback 只在**归一后为空**时才生效，所以有"development"时不会补上"office"。 */
    expect(normalizeCategorySet(["development", "not-a-category", "", "  ", "DESIGN"], "office"))
      .toEqual(["development"]);
    /* 全是脏值 → 才轮到 fallback */
    expect(normalizeCategorySet(["not-a-category", ""], "office")).toEqual(["office"]);
    expect(normalizeCategorySet([], "office")).toEqual(["office"]);
    expect(resolveCategorySet({ category: "nonsense" as never, categories: ["nonsense" as never] }))
      .toEqual([]);
  });

  it("ac05_other_is_never_a_member_but_may_stay_as_the_primary", () => {
    /* 「其他」= 未分类：能留在 `category` 上（旧行为不变），但**不许**进多选集合 */
    expect(normalizeCategorySet(["other", "development"], "other")).toEqual(["development"]);
    expect(normalizeCategorySet(["other"], "other")).toEqual([]);
    expect(normalizeCategorySet(["other", "other"], undefined)).toEqual([]);
    expect(normalizeCategorySet(["development", "development", "design"], undefined))
      .toEqual(["development", "design"]);
  });
});

describe("事项绑定的归一", () => {
  it("ac06_dirty_item_ids_are_dropped_and_duplicates_collapse", () => {
    expect(normalizeItemBindings([
      { itemId: 7 },
      { itemId: 7, category: "design" },
      { itemId: 0 },
      { itemId: -3 },
      { itemId: 4.5 },
      { itemId: Number.NaN },
      { itemId: 9, category: "office" },
      { itemId: 9 },
    ])).toEqual([{ itemId: 7 }, { itemId: 9, category: "office" }]);
  });

  it("ac07_an_illegal_or_other_binding_category_degrades_to_follow_the_primary", () => {
    expect(normalizeItemBindings([
      { itemId: 1, category: "other" },
      { itemId: 2, category: "nonsense" as never },
      { itemId: 3, category: "custom:any-extended-id" as never },
    ])).toEqual([
      { itemId: 1 },
      { itemId: 2 },
      { itemId: 3, category: "custom:any-extended-id" },
    ]);
  });

  it("ac08_an_empty_or_all_dirty_binding_list_yields_an_empty_array", () => {
    expect(normalizeItemBindings(undefined)).toEqual([]);
    expect(normalizeItemBindings([])).toEqual([]);
    expect(normalizeItemBindings([{ itemId: 0 }, { itemId: -1 }])).toEqual([]);
  });
});

describe("写盘", () => {
  it("ac09_serialize_then_parse_is_idempotent", () => {
    const once = serializeAppOverride({
      category: "design",
      categories: ["design", "development", "design"],
      itemBindings: [{ itemId: 5, category: "development" }, { itemId: 5 }],
      color: "#abcdef",
      displayName: "Figma",
      track: false,
    });
    const parsed = parseAppOverride(once);
    expect(parsed).toMatchObject({
      category: "design",
      categories: ["design", "development"],
      itemBindings: [{ itemId: 5, category: "development" }],
      color: "#ABCDEF",
      displayName: "Figma",
      track: false,
    });
    /* 再写一次必须给出同样的键值（否则每次保存都会产生一次无意义的 diff） */
    expect(JSON.parse(serializeAppOverride(parsed as AppOverride))).toEqual(JSON.parse(once));
  });

  it("ac09b_serialize_does_not_trim_but_parse_does", () => {
    /* 现状记录（不是缺陷：所有调用方传进来的 override 都已经过 `normalizeAppOverride`
       或 `buildQuickAppOverride`，那里会 trim）。含义是"写盘函数自己不做归一"，
       一次往返才收敛 —— 判据里必须知道这一点，否则会写出永远相等的假断言。 */
    const raw = JSON.parse(serializeAppOverride({ displayName: "  Figma  " })) as { displayName: string };
    expect(raw.displayName).toBe("  Figma  ");
    expect(parseAppOverride(JSON.stringify({ displayName: "  Figma  " }))?.displayName).toBe("Figma");
  });

  it("ac10_serialize_never_writes_other_into_the_set", () => {
    const raw = JSON.parse(serializeAppOverride({ category: "other" })) as { categories: string[] };
    expect(raw.categories).toEqual([]);
  });
});

describe("「其他」= 未分类（D-3 已修）", () => {
  /* `appOverrideCodec.ts` 文件头写着：
     ① `category` 恒等于 `categories[0]`；② `categories` 里不出现 `other`。
     用户点「其他」（= 未分类）时 `QuickClassificationSurface.saveCategory` 传的就是
     `{ category: "other" }`。修法：把「其他」归一成"清空主分类 + 清空集合"，
     于是写回的是一条真正未分类的记录（其余字段都没有时整条置 null）。 */
  it("ac11_setting_the_primary_to_other_keeps_the_documented_invariants", () => {
    const current: AppOverride = {
      category: "development",
      categories: ["development", "design"],
    };
    const next = buildQuickAppOverride(current, { category: "other" }, 1);
    const set = next?.categories ?? [];
    expect(set, "② 集合里不许出现 other").not.toContain("other");
    expect(next?.category, "① 主分类必须等于集合首项").toBe(set[0]);
  });

  it("ac12_other_clears_the_category_state_instead_of_becoming_a_zombie_primary", () => {
    /* 修之前的现网后果：应用变成一条 `category="other"` + `categories=[真分类…]` 的记录，
       落盘时 `other` 被 serialize 剔掉，读回来 `category("other") ≠ categories[0]`，
       用户下次打开「应用设置」看到的主分类仍是 development —— 与刚选的「其他」矛盾。
       现在：分类状态整体归零；其它有意义字段（别名 / 绑定）照旧保留。 */
    const current: AppOverride = {
      category: "development",
      categories: ["development", "design"],
    };
    expect(buildQuickAppOverride(current, { category: "other" }, 1), "只剩分类时整条置 null")
      .toBeNull();

    const withAlias: AppOverride = { ...current, displayName: "Code" };
    const next = buildQuickAppOverride(withAlias, { category: "other" }, 1);
    expect(next).toMatchObject({ enabled: true, updatedAt: 1, displayName: "Code" });
    expect(next?.category).toBeUndefined();
    expect(next?.categories).toBeUndefined();
    /* 往返一致：写盘再读回来仍然是"未分类 + 别名"（归一函数不保留空分类键） */
    const roundTripped = parseAppOverride(serializeAppOverride(next as AppOverride));
    expect(roundTripped?.category).toBeUndefined();
    expect(roundTripped?.categories).toBeUndefined();
    expect(roundTripped?.displayName).toBe("Code");
  });
});
