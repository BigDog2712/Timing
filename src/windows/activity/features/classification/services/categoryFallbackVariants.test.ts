import { describe, expect, it } from "vitest";

import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { buildDeleteCategoryBatchMutations } from "./categoryDefinitionMutations.ts";
import { buildQuickAppOverride } from "./quickClassification.ts";
import {
  normalizeAppOverride,
  parseAppOverride,
  resolveCategorySet,
  serializeAppOverride,
} from "../../../shared/classification/appOverrideCodec.ts";

/**
 * 分类删除 / 「其他」/ `siteRule` 的**变体回归**（`categoryDeleteRegression.test.ts` 的补集）。
 *
 * 与那份文件的分工：那边走**主干**（主分类命中、整条回落、绑定降级），这里只放三件
 * 最容易被"修一半"的**变体**：
 *   ① D-4 的**副分类变体**：被删分类不在 `category` 上、只在 `categories` 里 →
 *      成员判定必须是 `resolveCategorySet(override).includes(category)`，不能只看 `category`。
 *   ② D-3 的**反向**：读到 D-3 之前的遗留记录（`category: "other"` + 真分类集合）时，
 *      只做一次别名编辑不许把集合清掉。
 *   ③ D-9 的**写盘侧**：`siteRule` 必须真的进到序列化结果里（而不只是"没被写成 null"）。
 *
 * 边界（别当成端到端已验证）：③ 只覆盖**写侧不丢**。读回来走的是后端
 * `cmd_get_web_links` 的快照缓存，不是这里断言的那段 JSON —— 那段往返在本仓前端没有
 * 对应用例，真要验得从 Rust 侧或集成测试走。
 */
const CATEGORY = "custom:category_reading" as const;

function replay(mutations: { key: string; value: string | null }[]) {
  const store = new Map<string, string | null>();
  for (const row of mutations) store.set(row.key, row.value);
  return store;
}

function storedApp(store: Map<string, string | null>, exe: string): AppOverride | null {
  const raw = store.get(`__app_override::${exe}`);
  return raw ? (JSON.parse(raw) as AppOverride) : null;
}

function storedWeb(store: Map<string, string | null>, domain: string): Record<string, unknown> | null {
  const raw = store.get(`__web_domain_override::${domain}`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe("D-4 · 被删分类只是副分类（成员判定必须看整个集合）", () => {
  it("qf10_a_secondary_membership_is_detected_and_pruned_without_touching_the_primary", () => {
    /* 主分类是 development，被删的 custom:阅读 只在集合里 —— 旧判定（只看 `category`）
       根本不会把这个应用当成成员，于是 `categories` 里的死 id 留了下来。 */
    const overrides: Record<string, AppOverride> = {
      "code.exe": {
        enabled: true,
        category: "development",
        categories: ["development", CATEGORY],
        displayName: "编辑器",
        color: "#315F9F",
        updatedAt: 1,
      },
    };
    const next = storedApp(replay(buildDeleteCategoryBatchMutations(CATEGORY, overrides, {})), "code.exe");

    expect(next, "副分类成员也必须被处理（否则死 id 留在集合里）").not.toBeNull();
    expect(next?.categories, "被删分类从集合里摘掉").toEqual(["development"]);
    expect(next?.category, "主分类本来就不是它 → 不许被改动").toBe("development");
    expect(next?.displayName, "别名照旧").toBe("编辑器");
    expect(next?.color, "颜色照旧").toBe("#315F9F");
    expect(resolveCategorySet(next)).toEqual(["development"]);
  });

  it("qf11_a_secondary_membership_does_not_leak_the_deleted_id_back_into_the_set", () => {
    /* 反证：如果判定漏了（把该应用当成"无关成员"跳过），集合里会留着 `custom:阅读`。
       读侧虽然会按已删清单过滤掉它，但一旦删除名单丢失（导入/重装），分类就会复活。 */
    const overrides: Record<string, AppOverride> = {
      "code.exe": { enabled: true, category: "development", categories: ["development", CATEGORY] },
    };
    const next = storedApp(replay(buildDeleteCategoryBatchMutations(CATEGORY, overrides, {})), "code.exe");
    expect(next?.categories ?? []).not.toContain(CATEGORY);
  });

  it("qf12_an_unrelated_app_is_not_touched_at_all", () => {
    const overrides: Record<string, AppOverride> = {
      "steam.exe": { enabled: true, category: "game", categories: ["game", "utility"] },
      "code.exe": { enabled: true, category: "development", categories: ["development", CATEGORY] },
    };
    const store = replay(buildDeleteCategoryBatchMutations(CATEGORY, overrides, {}));
    expect(store.has("__app_override::steam.exe"), "既不在主分类也不在集合里 → 一条都不许写").toBe(false);
    expect(store.has("__app_override::code.exe")).toBe(true);
  });

  it("qf13_a_legacy_single_category_member_still_degrades_to_a_deleted_override", () => {
    /* 老数据只有 `category` 且就是被删的那个：没有任何其它信息 → 整条写 null（老行为不变） */
    const overrides: Record<string, AppOverride> = {
      "old.exe": { enabled: true, category: CATEGORY, updatedAt: 2 },
    };
    const store = replay(buildDeleteCategoryBatchMutations(CATEGORY, overrides, {}));
    expect(store.get("__app_override::old.exe")).toBeNull();
  });
});

describe("D-9 · siteRule 必须真的写进序列化结果（只验写侧，读侧走 Rust 快照）", () => {
  it("qf14_the_site_rule_survives_the_round_trip_through_storage", () => {
    const web: Record<string, WebDomainOverride> = {
      "site.com": { category: CATEGORY, siteRule: { pathPrefix: "/docs" } as never, updatedAt: 6 },
    };
    const stored = storedWeb(
      replay(buildDeleteCategoryBatchMutations(CATEGORY, {}, web)),
      "site.com",
    );

    expect(stored, "记录不许被整条删掉").not.toBeNull();
    expect(stored?.category, "被删的分类要摘掉").toBeNull();
    /* 关键：不是"没写成 null"，而是真的把规则写进了那一行 JSON —— 否则读侧拿不到 */
    expect(stored?.siteRule).toEqual({ pathPrefix: "/docs" });
  });

  it("qf15_a_web_domain_with_no_category_still_keeps_its_site_rule_untouched", () => {
    /* 反证：删一个与它无关的分类时，既不该写 null，也不该丢 siteRule */
    const web: Record<string, WebDomainOverride> = {
      "keep.com": { category: "design", siteRule: { pathPrefix: "/a" } as never, updatedAt: 7 },
    };
    const store = replay(buildDeleteCategoryBatchMutations(CATEGORY, {}, web));
    expect(store.has("__web_domain_override::keep.com"), "无关域名一条都不许写").toBe(false);
  });
});

describe("D-3 · 「其他」= 清空分类状态", () => {
  it("qf16_the_other_patch_clears_both_the_primary_and_the_set", () => {
    const current: AppOverride = { category: "development", categories: ["development", "design"] };
    expect(buildQuickAppOverride(current, { category: "other" }, 1), "只剩分类信息 → 整条置 null").toBeNull();
  });

  it("qf17_other_keeps_other_fields_but_drops_every_category_trace", () => {
    const current: AppOverride = {
      category: "development",
      categories: ["development", "design"],
      displayName: "编辑器",
      color: "#315F9F",
      itemBindings: [{ itemId: 7, category: "design" }],
    };
    const next = buildQuickAppOverride(current, { category: "other" }, 2);
    expect(next).not.toBeNull();
    expect(next?.category).toBeUndefined();
    expect(next?.categories).toBeUndefined();
    /* 别名 / 颜色 / 事项绑定跟"归到哪个分类"是两件事，不许连带清掉 */
    expect(next?.displayName).toBe("编辑器");
    expect(next?.color).toBe("#315F9F");
    expect(next?.itemBindings).toEqual([{ itemId: 7, category: "design" }]);
  });

  it("qf18_a_legacy_other_row_survives_an_alias_only_edit_with_its_set_intact", () => {
    /* 反向（最容易被修坏的一侧）：D-3 之前落盘的历史记录 `category: "other"` +
       真实分类集合。用户只改一次别名 —— 集合必须原样留着，不许被"归一成清空"。 */
    const legacy = normalizeAppOverride({
      category: "other",
      categories: ["development", "design"],
      enabled: true,
    }) as AppOverride;
    expect(legacy.categories, "读入时集合要保留").toEqual(["development", "design"]);

    const next = buildQuickAppOverride(legacy, { displayName: "新名字" }, 3);
    expect(next?.categories, "只改别名不许把用户的分类集合清掉").toEqual(["development", "design"]);
    expect(next?.displayName).toBe("新名字");
    /* 主分类恒等于集合首项（不变式①）：`other` 被归一成"没有主分类"，由集合首项接班 */
    expect(next?.category).toBe("development");
    expect(next?.categories?.[0]).toBe(next?.category);
  });

  it("qf19_other_never_survives_a_serialize_round_trip", () => {
    const raw = JSON.parse(serializeAppOverride({ category: "other" })) as {
      category: unknown;
      categories: unknown;
    };
    expect(raw.categories).toEqual([]);
    const back = parseAppOverride(JSON.stringify(raw));
    expect(resolveCategorySet(back), "读回来是未分类，不是某个幽灵分类").toEqual([]);
  });
});
