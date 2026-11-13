import { describe, expect, it } from "vitest";

import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { buildDeleteCategoryBatchMutations } from "./categoryDefinitionMutations.ts";
import { resolveCategorySet } from "../../../shared/classification/appOverrideCodec.ts";

/**
 * 「删掉的自定义分类会原地复活」——**回归判据**（[QA 本轮独立复核]）。
 *
 * 这是本仓踩过的坑（`buildCategoryMemberFallbackMutations` 的注释里记着）：分类候选
 * （`buildQuickClassificationCategoryOptions`）不仅从 `loadedPersistedCategoryIds` 收集，
 * 还从**每一个 app override 与 web domain override 的 `category`** 收集。所以删分类时
 * 只要漏掉任何一侧的成员回落，那个 id 就会在下一次 bootstrap 里被重新收集、画回选项里。
 *
 * 原有的 `categoryDefinitionMutations.test.ts` **只测了 app 一侧**（第三个参数
 * `webDomainOverrides` 从来没传过），本文件补齐：
 *   · d10 两侧同时引用 → 两侧成员都要清，各自其余字段都要保住；
 *   · d11 网页域只有分类这一条信息 → 整条 override 写 null（不是留一个空壳）；
 *   · d12 成员回落与四条定义清理必须同一批（否则读侧会看到一个"已删却还在被指"的中间态）；
 *   · d13 `categories` / `itemBindings` 也要一起回落 —— **本轮新字段带来的缺陷 D-4**；
 *   · d14 既有风险（非本轮）：网页域的 `siteRule` 在回落写盘时被丢掉。
 *
 * `replay()` 把 mutation 数组当成"对键值表的写操作"执行一遍，再按生产代码的读入函数
 * （`ProcessMapper.fromOverrideStorageValue` / `parseAppOverride`）读回来 ——
 * 只断言 key/value 的字符串会漏掉"写进去但读不回来"的那一类问题。
 */
const CATEGORY = "custom:category_reading" as const;

function replay(mutations: { key: string; value: string | null }[]) {
  const store = new Map<string, string | null>();
  for (const row of mutations) store.set(row.key, row.value);
  return store;
}

function storedApp(store: Map<string, string | null>, exe: string): unknown {
  const raw = store.get(`__app_override::${exe}`);
  if (raw === undefined || raw === null) return null;
  return JSON.parse(raw);
}

function storedWeb(store: Map<string, string | null>, domain: string): unknown {
  const raw = store.get(`__web_domain_override::${domain}`);
  if (raw === undefined || raw === null) return null;
  return JSON.parse(raw);
}

describe("删除自定义分类 · 两侧成员回落", () => {
  const appOverrides: Record<string, AppOverride> = {
    /* 主分类就是被删的那个，且**其余设置很丰富** —— 回落时一个字都不许丢 */
    "code.exe": {
      enabled: true,
      category: CATEGORY,
      displayName: "编辑器",
      color: "#315F9F",
      track: false,
      captureTitle: false,
      updatedAt: 1,
    },
    /* 与这个分类无关 */
    "steam.exe": { enabled: true, category: "game", updatedAt: 2 },
  };
  const webDomainOverrides: Record<string, WebDomainOverride> = {
    "example.com": {
      category: CATEGORY,
      displayName: "示例站",
      color: "#112233",
      captureTitle: false,
      updatedAt: 3,
    },
    /* 与这个分类无关：网页域一侧也要有"不许乱动"的对照 */
    "other.com": { category: "design", updatedAt: 4 },
  };

  it("d10_both_the_app_and_the_web_domain_member_fall_back_and_keep_their_own_fields", () => {
    const mutations = buildDeleteCategoryBatchMutations(CATEGORY, appOverrides, webDomainOverrides);
    const store = replay(mutations);

    /* app 一侧：分类没了，别名 / 颜色 / 不追踪标题全在 */
    expect(storedApp(store, "code.exe")).toMatchObject({
      category: null,
      displayName: "编辑器",
      color: "#315F9F",
      track: false,
      captureTitle: false,
    });
    /* web 一侧：**这就是原测试漏掉的那一半** —— 不清它，分类会因某个域名还指着它而复活 */
    expect(storedWeb(store, "example.com")).toMatchObject({
      category: null,
      displayName: "示例站",
      color: "#112233",
      captureTitle: false,
    });
    /* 无关成员一条都不许动 */
    expect(store.has("__app_override::steam.exe")).toBe(false);
    expect(store.has("__web_domain_override::other.com")).toBe(false);
  });

  it("d11_a_web_domain_that_only_had_the_category_is_deleted_entirely", () => {
    const store = replay(buildDeleteCategoryBatchMutations(
      CATEGORY,
      {},
      { "bare.com": { category: CATEGORY, updatedAt: 5 } },
    ));
    /* 留一个 `{category:null,...}` 的空壳 = 一条永远读不出东西的记录 */
    expect(store.get("__web_domain_override::bare.com")).toBeNull();
  });

  it("d12_the_four_definition_keys_and_the_member_fallbacks_are_one_batch", () => {
    const mutations = buildDeleteCategoryBatchMutations(CATEGORY, appOverrides, webDomainOverrides);
    const keys = new Set(mutations.map((row) => row.key));

    for (const prefix of [
      "__custom_category::",
      "__deleted_category::",
      "__category_label_override::",
      "__category_default_color_assignment::",
    ]) {
      expect(keys.has(`${prefix}${CATEGORY}`), `${prefix} 少一条 → 分类复活`).toBe(true);
    }
    expect(keys.has("__app_override::code.exe")).toBe(true);
    expect(keys.has("__web_domain_override::example.com")).toBe(true);
    /* 同一批（同一个事务）意味着这 6 条的 value 全都在这次提交里，不存在中间态 */
    expect(mutations.length).toBe(6);
  });

  it("d13_dropping_the_primary_keeps_the_multi_category_set_and_the_item_bindings", () => {
    /* [修复 D-4 后] 回落走 `buildQuickAppOverride`（唯一重建入口）：被删分类从集合里摘掉，
       剩下的成员顺延成为主分类，事项绑定原样保留。
       修之前回落用的是旧的 `buildAppMappingOverride`（白名单里没有这两组新字段），
       于是删一个自定义分类 = 该应用同时丢掉其它分类成员与全部事项绑定，
       极端情形（主分类是这个应用唯一分类）还会连带变成"未分类"。 */
    const withSet: Record<string, AppOverride> = {
      "code.exe": {
        enabled: true,
        category: CATEGORY,
        categories: [CATEGORY, "development"],
        itemBindings: [{ itemId: 7, category: "development" }],
        displayName: "编辑器",
        updatedAt: 1,
      },
    };
    const store = replay(buildDeleteCategoryBatchMutations(CATEGORY, withSet, {}));
    const next = storedApp(store, "code.exe") as AppOverride;

    expect(resolveCategorySet(next), "其余分类成员必须留住（不许整段丢）").toEqual(["development"]);
    expect(next.category, "集合非空时主分类要顺延成剩下的第一个，不是 null").toBe("development");
    expect(next.itemBindings, "事项绑定必须原样保留").toEqual([{ itemId: 7, category: "development" }]);
  });

  it("d14_the_record_never_degrades_to_unclassified_while_members_remain", () => {
    /* 现状判据（D-4 修复后的正确行为）：
       ① 写回的 `categories` 里不再有被删的分类；② 记录没有被写成空壳
       （`categories: []` + `category: null` = 这个应用从「开发+阅读」掉成「未分类」）。 */
    const withSet: Record<string, AppOverride> = {
      "code.exe": {
        enabled: true,
        category: CATEGORY,
        categories: [CATEGORY, "development"],
        itemBindings: [{ itemId: 7, category: "development" }],
        displayName: "编辑器",
        updatedAt: 1,
      },
    };
    const next = storedApp(
      replay(buildDeleteCategoryBatchMutations(CATEGORY, withSet, {})),
      "code.exe",
    ) as AppOverride;
    expect(next.categories, "被删分类不许留在集合里").toEqual(["development"]);
    expect(next.displayName, "别名这类老字段照旧保住").toBe("编辑器");
    expect(resolveCategorySet(next)).toEqual(["development"]);
  });

  it("d14b_a_binding_that_pointed_at_the_deleted_category_falls_back_to_the_primary", () => {
    /* 事项绑定里指着被删分类的那一条回落到"跟随主分类"（不留悬空引用） */
    const withSet: Record<string, AppOverride> = {
      "code.exe": {
        category: CATEGORY,
        categories: [CATEGORY, "development"],
        itemBindings: [{ itemId: 7, category: CATEGORY }, { itemId: 8, category: "development" }],
        updatedAt: 1,
      },
    };
    const next = storedApp(
      replay(buildDeleteCategoryBatchMutations(CATEGORY, withSet, {})),
      "code.exe",
    ) as AppOverride;
    expect(next.itemBindings).toEqual([{ itemId: 7 }, { itemId: 8, category: "development" }]);
    expect(next.category).toBe("development");
  });
});

describe("既有风险（非本轮引入）：网页域的 siteRule 在回落时随整条记录一起消失", () => {
  it("d15_a_web_domain_whose_only_other_data_was_a_site_rule_keeps_the_rule", () => {
    /* [修复 D-9 后] 回落路径原样带上 builder 不产出的字段（`siteRule` / `knownDomain`），
       `normalizeWebDomainOverride` 也把 `siteRule` 算作"有意义的值"并写进序列化。
       修之前：归一结果被判空 → 写成 `value: null` → **整条记录被删**，分组规则一起没了。
       这条不是本轮改动引入的（`categoryDefinitionMutations.ts` 当时零改动），
       但"在应用设置弹窗里删分类"这个新入口让它第一次变得可触发。
       边界：只覆盖**写侧不丢**。应用设置弹窗里读回一条网页域 override 走的是后端
       `cmd_get_web_links` 的快照，不是这里断言的那段 JSON —— 端到端往返未在本文件中验证。 */
    const store = replay(buildDeleteCategoryBatchMutations(
      CATEGORY,
      {},
      { "site.com": { category: CATEGORY, siteRule: { pathPrefix: "/docs" } as never, updatedAt: 6 } },
    ));
    const stored = storedWeb(store, "site.com") as { category?: unknown; siteRule?: unknown } | null;
    expect(stored, "记录不许被整条删掉").not.toBeNull();
    expect(stored?.category, "被删的分类当然要摘掉").toBeNull();
    expect(stored?.siteRule).toEqual({ pathPrefix: "/docs" });
  });
});
