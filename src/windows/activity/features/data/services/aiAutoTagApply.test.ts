import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI 自动打标签 · 写入层（[0.12.5]）。
 *
 * 这里钉的是"两套写面各自不许顺手多写/少写什么"：
 *   · 应用侧**只换 `tags`**，`track` / `displayName` 这些用户设置不能被一次打标签清掉；
 *   · 事项侧走的是**意图**（分析窗没有 `set_item_tags` 命令），载荷字段名与命令一致；
 *   · 一条失败不许拖累其余条（这里没有事务，也不该装作有）。
 */
const g = vi.hoisted(() => ({
  overrides: {} as Record<string, Record<string, unknown> | null>,
  saveOverride: vi.fn(),
  createDefinition: vi.fn(),
  emitIntent: vi.fn(),
}));

vi.mock("../../../shared/classification/appClassification.ts", () => ({
  AppClassification: { getUserOverride: (exe: string) => g.overrides[exe] ?? null },
}));

vi.mock("../../classification/services/classificationService.ts", () => ({
  ClassificationService: { saveAppOverride: (exe: string, override: unknown) => g.saveOverride(exe, override) },
}));

vi.mock("../../../platform/persistence/tagAdminGateway.ts", () => ({
  createTagDefinition: (path: string) => g.createDefinition(path),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({
  emitHostIntent: (intent: unknown) => g.emitIntent(intent),
}));

import {
  applyAppAutoTags,
  applyAutoTagPlan,
  applyItemAutoTags,
  persistNewTagDefinitions,
} from "./aiAutoTagApply.ts";

beforeEach(() => {
  g.overrides = {};
  g.saveOverride = vi.fn(async () => undefined);
  g.createDefinition = vi.fn(async () => []);
  g.emitIntent = vi.fn(async () => true);
});

describe("应用侧", () => {
  it("p01_replaces_tags_but_keeps_the_other_user_settings", async () => {
    g.overrides["code.exe"] = { tags: ["旧"], track: false, displayName: "VS Code", color: "#123456" };
    const result = await applyAppAutoTags([{ exeName: "code.exe", tags: ["工作", "学习"] }]);
    expect(result).toEqual({ applied: 1, failed: 0 });
    /* 展开 current 而不是只写 `{ tags }`：少展开一个字段就等于"打一次标签顺手把
       『不计时』改回默认"，而用户不会想到是这里动的。 */
    expect(g.saveOverride).toHaveBeenCalledWith("code.exe", {
      tags: ["工作", "学习"],
      track: false,
      displayName: "VS Code",
      color: "#123456",
    });
  });

  it("p02_writes_only_tags_when_the_app_had_no_override_yet", async () => {
    await applyAppAutoTags([{ exeName: "new.exe", tags: ["娱乐"] }]);
    /* **不写** category / categories：标签路径（`娱乐/燕云`）不是合法分类键，
       塞进去会被 `normalizeAppOverride` 丢掉，读侧反而多一条死数据。 */
    expect(g.saveOverride).toHaveBeenCalledWith("new.exe", { tags: ["娱乐"] });
  });

  it("p03_a_failing_app_does_not_stop_the_others", async () => {
    g.saveOverride = vi.fn(async (exe: string) => {
      if (exe === "boom.exe") throw new Error("写盘失败");
    });
    const result = await applyAppAutoTags([
      { exeName: "boom.exe", tags: ["工作"] },
      { exeName: "ok.exe", tags: ["学习"] },
    ]);
    expect(result).toEqual({ applied: 1, failed: 1 });
    expect(g.saveOverride).toHaveBeenCalledTimes(2);
  });
});

describe("事项侧", () => {
  it("p04_sends_one_intent_per_item_with_the_command_field_names", async () => {
    const result = await applyItemAutoTags([
      { itemId: 7, tags: ["学习"] },
      { itemId: 8, tags: [] },
    ]);
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(g.emitIntent).toHaveBeenNthCalledWith(1, { action: "set_item_tags", itemId: 7, tags: ["学习"] });
    /* 空数组 = 清空（全量覆盖的语义），照样要发 —— 不发的话"摘掉所有标签"点了等于没点 */
    expect(g.emitIntent).toHaveBeenNthCalledWith(2, { action: "set_item_tags", itemId: 8, tags: [] });
  });

  it("p05_an_unsent_intent_counts_as_failure_but_does_not_throw", async () => {
    g.emitIntent = vi.fn(async (intent: { itemId: number }) => intent.itemId !== 7);
    const result = await applyItemAutoTags([
      { itemId: 7, tags: ["学习"] },
      { itemId: 8, tags: ["工作"] },
    ]);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });
});

describe("新建标签的定义行", () => {
  it("p06_counts_failures_without_throwing", async () => {
    g.createDefinition = vi.fn(async (path: string) => {
      if (path === "坏/标签") throw new Error("非法路径");
      return [];
    });
    await expect(persistNewTagDefinitions(["学习/考公", "坏/标签"])).resolves.toBe(1);
    expect(g.createDefinition).toHaveBeenCalledTimes(2);
  });
});

describe("两套写面一起跑", () => {
  it("p07_outcome_adds_up_both_sides", async () => {
    g.saveOverride = vi.fn(async () => undefined);
    g.emitIntent = vi.fn(async (intent: { itemId: number }) => intent.itemId !== 9);
    const outcome = await applyAutoTagPlan({
      apps: [{ exeName: "code.exe", tags: ["工作"] }],
      items: [{ itemId: 7, tags: ["学习"] }, { itemId: 9, tags: ["娱乐"] }],
    });
    expect(outcome).toEqual({ apps: 1, items: 1, failed: 1 });
  });
});
