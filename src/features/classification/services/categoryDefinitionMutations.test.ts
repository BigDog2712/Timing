import { describe, expect, it } from "vitest";

import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import {
  buildCreateCategoryDefinitionMutations,
  buildDeleteCategoryBatchMutations,
} from "./categoryDefinitionMutations.ts";

/**
 * 分类增删的 mutation 批次（[本轮]）。
 *
 * 判据钉的是**键与值**，不是函数名：
 *   · 新建 → `__custom_category::<id>` = 时间戳 + `__category_label_override::<id>` = 名字。
 *     少写第二条 → 分类列表里出现一条叫 `custom:category_xxx` 的怪名字；
 *     前缀写错（`__custom_cat::`）→ Rust 侧读不到，分类"建了但没建"。
 *   · 删除 → 成员回落（`__app_override::<exe>`）+ 四条清理
 *     （定义 / 已删除标记 / 标签 / 默认配色）。少一条 → 分类会在下一次 bootstrap 里复活。
 *   · 内置分类 → 批次为空（`other` 是回落目标，删了就没有东西可以回落了）。
 */
const CATEGORY = "custom:category_test" as const;

function parse(row: { key: string; value: string | null } | undefined): unknown {
  if (!row || row.value === null) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

describe("buildCreateCategoryDefinitionMutations", () => {
  it("c01_writes_the_definition_and_the_label_with_the_documented_prefixes", () => {
    const mutations = buildCreateCategoryDefinitionMutations(CATEGORY, "阅读");

    expect(mutations).toHaveLength(2);
    expect(mutations[0]?.key).toBe(`__custom_category::${CATEGORY}`);
    /* 定义的值是时间戳（"这个 id 存在"），不是名字 —— 名字在标签那条里 */
    expect(Number(mutations[0]?.value)).toBeGreaterThan(0);
    expect(mutations[1]).toEqual({
      key: `__category_label_override::${CATEGORY}`,
      value: "阅读",
    });
  });

  it("c02_the_id_keeps_the_custom_prefix_that_the_loader_looks_for", () => {
    const mutations = buildCreateCategoryDefinitionMutations(CATEGORY, "阅读");

    /* 键的尾巴必须还是 `custom:...`：`loadPersistedCategoryIds` 只收 `isExtendedCategory`
       的尾巴，前缀被吞掉一个字符 → 新建的分类在重启后消失 */
    expect(mutations[0]?.key.startsWith("__custom_category::custom:")).toBe(true);
    expect(mutations[1]?.key.startsWith("__category_label_override::custom:")).toBe(true);
  });
});

describe("buildDeleteCategoryBatchMutations", () => {
  const overrides: Record<string, AppOverride> = {
    "code.exe": { enabled: true, category: CATEGORY, updatedAt: 1 },
    /* 只分了类、别的什么都没设 → 回落结果为空 → 整条 override 写 null */
    "chrome.exe": { enabled: true, category: CATEGORY, updatedAt: 2 },
    /* 别名 + 颜色：回落时**必须保留**，只去掉 category */
    "wechat.exe": { enabled: true, category: CATEGORY, displayName: "微信", color: "#112233", updatedAt: 3 },
    /* 不属于这个分类：一条都不该动 */
    "steam.exe": { enabled: true, category: "game", updatedAt: 4 },
  };

  it("d01_falls_members_back_and_clears_the_four_definition_keys", () => {
    const mutations = buildDeleteCategoryBatchMutations(CATEGORY, overrides);

    const byKey = new Map(mutations.map((row) => [row.key, row.value]));
    /* 成员回落：3 条 app override 里有 2 条只带 category → 写 null；
       带别名/颜色的那条保留其余字段 */
    expect(byKey.get("__app_override::code.exe")).toBeNull();
    expect(byKey.get("__app_override::chrome.exe")).toBeNull();
    expect(parse({ key: "wechat.exe", value: byKey.get("__app_override::wechat.exe") ?? null })).toMatchObject({
      category: null,
      displayName: "微信",
      color: "#112233",
    });
    expect(byKey.has("__app_override::steam.exe")).toBe(false);

    /* 四条清理（少一条分类就会复活） */
    expect(byKey.get(`__custom_category::${CATEGORY}`)).toBeNull();
    expect(byKey.get(`__deleted_category::${CATEGORY}`)).toBeNull();
    expect(byKey.get(`__category_label_override::${CATEGORY}`)).toBeNull();
    expect(byKey.get(`__category_default_color_assignment::${CATEGORY}`)).toBeNull();
  });

  it("d02_the_member_fallback_and_the_definition_cleanup_are_one_batch", () => {
    const mutations = buildDeleteCategoryBatchMutations(CATEGORY, overrides);

    /* 一批提交（同一个事务）：分两批的话中间那一瞬"分类没了、应用还指着它" */
    expect(mutations.length).toBeGreaterThanOrEqual(3 + 4);
    expect(mutations.filter((row) => row.key.startsWith("__app_override::")).length).toBe(3);
  });

  it("d03_builtin_categories_produce_no_mutations_at_all", () => {
    /* 内置 11 个分类不可删（`other` 尤其不能：它是所有回落的目标） */
    for (const builtin of ["other", "browser", "ai"] as const) {
      expect(buildDeleteCategoryBatchMutations(builtin, overrides)).toEqual([]);
    }
  });
});
