import { describe, expect, it } from "vitest";

import {
  MAX_CANDIDATES,
  MAX_TAGS_PER_TARGET,
  buildApplyPlan,
  buildTagCandidates,
  collectCreatedTags,
  defaultSelection,
  mergeSuggestions,
  normalizeTagList,
  rowChips,
  summarizePlan,
  visibleRows,
  type AutoTagRow,
  type AutoTagTarget,
} from "./aiAutoTag.ts";

/**
 * AI 自动打标签的纯逻辑判据（[0.12.5]）。
 *
 * 这组钉的都是"错了不会报错、只会静默写坏数据"的地方：
 *   · 候选表超 200 → 后端整批 400（不是逐条丢）；
 *   · 建议里的脏 id → 挂错行 = 给 A 应用打上 B 的标签；
 *   · 勾选语义 → "没动" 与 "全摘掉" 混为一谈会一夜洗掉所有手填标签。
 */

function target(over: Partial<AutoTagTarget> & Pick<AutoTagTarget, "id">): AutoTagTarget {
  return { kind: "app", name: over.id, text: over.id, existing: [], ...over };
}

function row(over: Partial<AutoTagRow> & Pick<AutoTagRow, "id">): AutoTagRow {
  return { kind: "app", name: over.id, text: over.id, existing: [], suggested: [], ...over };
}

describe("候选表", () => {
  it("a01_dedupes_case_insensitively_and_drops_empty_paths", () => {
    const candidates = buildTagCandidates(["学习/考公", "学习/考公", "学习/考公/", "", "  ", "娱乐"]);
    /* 拼音序（`localeCompare('zh-CN')`）：学(xue) 在 娱(yu) 之前 —— 与标签管理页的排序同一把尺子 */
    expect(candidates.map((candidate) => candidate.label)).toEqual(["学习/考公", "娱乐"]);
    /* key 与 label 逐字相同：后端按 label 折回 key，两者不一致就会出现
       "模型照抄了 label，解析却按 key 找不到" → 全部判为未知标签。 */
    expect(candidates[0]).toEqual({ key: "学习/考公", label: "学习/考公" });
  });

  it("a02_caps_at_the_backend_limit_instead_of_letting_the_request_fail", () => {
    const many = Array.from({ length: MAX_CANDIDATES + 25 }, (_, index) => `学习/科目${index}`);
    expect(buildTagCandidates(many)).toHaveLength(MAX_CANDIDATES);
  });

  it("a03_skips_paths_that_violate_the_limits_instead_of_throwing", () => {
    /* 5 级超限 / 单级超 32 字：这两条会让 `normalizeTagPath` 抛错。
       候选表是"能挑的集合"，一条脏路径不该让整页打不开。 */
    const deep = "a/b/c/d/e";
    const long = `学习/${"字".repeat(40)}`;
    expect(buildTagCandidates([deep, long, "工作"]).map((candidate) => candidate.label)).toEqual(["工作"]);
  });
});

describe("标签列表归一", () => {
  it("a04_caps_at_twelve_and_dedupes", () => {
    const tags = Array.from({ length: MAX_TAGS_PER_TARGET + 3 }, (_, index) => `标签${index}`);
    expect(normalizeTagList([...tags, tags[0]])).toHaveLength(MAX_TAGS_PER_TARGET);
  });

  it("a05_strips_leading_hashes_and_backslashes_like_the_editor_does", () => {
    expect(normalizeTagList(["#学习\\考公"])).toEqual(["学习/考公"]);
  });
});

describe("建议挂回目标行", () => {
  it("a06_drops_unknown_ids_and_duplicate_rows", () => {
    const rows = mergeSuggestions(
      [target({ id: "code.exe" }), target({ id: "steam.exe" })],
      [
        { id: "code.exe", tags: ["工作/开发"] },
        { id: "code.exe", tags: ["不该生效"] },
        { id: "幻觉.exe", tags: ["娱乐"] },
      ],
    );
    expect(rows.map((entry) => entry.id)).toEqual(["code.exe", "steam.exe"]);
    expect(rows[0].suggested).toEqual(["工作/开发"]);
    expect(rows[1].suggested).toEqual([]);
  });

  it("a07_keeps_the_input_order_even_when_the_model_answers_out_of_order", () => {
    const rows = mergeSuggestions(
      [target({ id: "a.exe" }), target({ id: "b.exe" })],
      [
        { id: "b.exe", tags: ["娱乐"] },
        { id: "a.exe", tags: ["工作"] },
      ],
    );
    expect(rows.map((entry) => entry.id)).toEqual(["a.exe", "b.exe"]);
  });

  it("a08_normalizes_suggested_and_existing_through_the_same_path_rules", () => {
    const rows = mergeSuggestions(
      [target({ id: "a.exe", existing: ["#工作", "工作/"] })],
      [{ id: "a.exe", tags: ["工作", "娱乐 "] }],
    );
    expect(rows[0].existing).toEqual(["工作"]);
    expect(rows[0].suggested).toEqual(["工作", "娱乐"]);
  });
});

describe("勾选默认值与 chip", () => {
  it("a09_default_selection_is_exactly_what_the_model_suggested", () => {
    expect(defaultSelection(row({ id: "a.exe", existing: ["工作"], suggested: ["学习"] }))).toEqual(["学习"]);
  });

  it("a10_chips_are_the_union_with_flags_so_removals_are_visible", () => {
    const chips = rowChips(row({ id: "a.exe", existing: ["工作"], suggested: ["学习", "工作"] }));
    expect(chips).toEqual([
      { tag: "工作", suggested: true, existing: true },
      { tag: "学习", suggested: true, existing: false },
    ]);
    /* 只在既有里、没被建议的：必须仍然出现（否则"会被清掉"这件事用户看不见） */
    const removal = rowChips(row({ id: "a.exe", existing: ["旧标签"], suggested: ["新标签"] }));
    expect(removal.find((chip) => chip.tag === "旧标签")).toEqual({
      tag: "旧标签",
      suggested: false,
      existing: true,
    });
  });

  it("a11_rows_without_suggestions_are_hidden_but_counted", () => {
    const rows = [row({ id: "a.exe", suggested: ["工作"] }), row({ id: "b.exe" })];
    expect(visibleRows(rows).map((entry) => entry.id)).toEqual(["a.exe"]);
  });
});

describe("写入计划", () => {
  const rows = [
    row({ kind: "app", id: "code.exe", suggested: ["工作"] }),
    /* 这一条**故意**不出现在后面的 selection 里：它是"用户没动"的样本。
       少了它，把"没动"当成"清空"的实现照样全绿（脏 id 那一行会替它兜住）。 */
    row({ kind: "app", id: "untouched.exe", suggested: ["娱乐"] }),
    row({ kind: "item", id: "12", suggested: ["学习"] }),
    row({ kind: "item", id: "not-a-number", suggested: ["娱乐"] }),
  ];

  it("a12_untouched_rows_are_not_written_and_emptied_rows_are_cleared", () => {
    const plan = buildApplyPlan(rows, { "app:code.exe": [], "item:12": ["学习"] });
    /* `code.exe` 出现在 selection 里但标签为空 = 用户把 chip 全摘了 = 清空；
       `untouched.exe` 没出现在 selection 里 = 没动 = **不写**（不是写成空数组）。 */
    expect(plan.apps).toEqual([{ exeName: "code.exe", tags: [] }]);
    expect(plan.items).toEqual([{ itemId: 12, tags: ["学习"] }]);
  });

  it("a13_item_ids_that_are_not_positive_integers_are_skipped", () => {
    const plan = buildApplyPlan(rows, {
      "item:not-a-number": ["娱乐"],
      "item:12": ["学习"],
    });
    expect(plan.items.map((entry) => entry.itemId)).toEqual([12]);
  });

  it("a14_summary_counts_only_what_will_actually_be_sent", () => {
    const plan = buildApplyPlan(rows, { "app:code.exe": [], "item:12": [] });
    expect(summarizePlan(plan)).toEqual({ apps: 1, items: 1, total: 2 });
    expect(summarizePlan({ apps: [], items: [] })).toEqual({ apps: 0, items: 0, total: 0 });
  });
});

describe("模型新建的标签", () => {
  it("a15_unions_both_responses_and_dedupes", () => {
    expect(collectCreatedTags([
      { created: ["娱乐/燕云", "学习/考公"] },
      { created: ["学习/考公", "工作/周报"] },
    ])).toEqual(["娱乐/燕云", "学习/考公", "工作/周报"]);
  });

  it("a16_tolerates_responses_without_the_field", () => {
    expect(collectCreatedTags([{}, { created: undefined }])).toEqual([]);
  });
});
