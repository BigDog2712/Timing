import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「AI 自动打标签」按钮（[0.12.5]）。
 *
 * 这组钉的是**接线**，不是文案：一次点击要发两个模式的请求、默认勾选要等于模型建议、
 * 点「应用」要把两套写面拆开。真实写入逻辑在 `aiAutoTagApply.test.ts` 里单独验。
 */
const g = vi.hoisted(() => ({
  apps: [] as Array<{ exeName: string; appName: string; totalDuration: number }>,
  items: [] as Array<{ id: number; name: string; isSystem: boolean }>,
  definitions: [] as string[],
  itemTags: [] as Array<{ itemId: number; tags: string[] }>,
  appTags: {} as Record<string, string[]>,
  enabled: { enabled: true, appTagsEnabled: true, itemTagsEnabled: true },
  suggest: vi.fn(),
  applyPlan: vi.fn(),
  persistDefinitions: vi.fn(),
  notices: [] as Array<{ text: string; tone: string }>,
  applied: 0,
}));

vi.mock("../../../platform/desktop/hostAiGateway.ts", () => ({
  aiConfigGet: async () => ({
    config: { ...g.enabled },
    hasKey: true,
    secretAvailable: true,
  }),
  aiSuggestTags: (request: unknown) => g.suggest(request),
}));

vi.mock("../../../platform/persistence/tagAdminGateway.ts", () => ({
  listTagDefinitions: async () => g.definitions,
  createTagDefinition: async () => [],
}));

vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: async () => g.items,
  listTimingItemTags: async () => g.itemTags,
}));

vi.mock("../../../shared/classification/appClassification.ts", () => ({
  AppClassification: { getAppTags: (exe: string) => g.appTags[exe] ?? [] },
}));

vi.mock("../../classification/services/classificationService.ts", () => ({
  ClassificationService: {
    ensureAppCatalogLoaded: async () => undefined,
    getAppCatalogSnapshot: () => ({ committed: { candidates: g.apps } }),
  },
}));

vi.mock("../services/aiAutoTagApply.ts", () => ({
  persistNewTagDefinitions: (paths: string[]) => g.persistDefinitions(paths),
  applyAutoTagPlan: (plan: unknown) => g.applyPlan(plan),
}));

import AiAutoTagButton from "./AiAutoTagButton.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function response(mode: string) {
  if (mode === "app") {
    return {
      suggestions: [{ id: "code.exe", tags: ["工作"] }],
      stats: { parsed: 1, dropped: 0, attempts: 1, batches: 1, failedBatches: 0 },
      created: [],
    };
  }
  return {
    suggestions: [{ id: "7", tags: ["学习"] }],
    stats: { parsed: 1, dropped: 0, attempts: 1, batches: 1, failedBatches: 0 },
    created: ["学习/考公"],
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
}

function byText(text: string): HTMLButtonElement | undefined {
  return buttons().find((button) => (button.textContent ?? "").includes(text));
}

async function mount() {
  act(() => {
    root.render(createElement(AiAutoTagButton, {
      onApplied: () => { g.applied += 1; },
      onNotice: (text: string, tone: "ok" | "error") => g.notices.push({ text, tone }),
    }));
  });
}

async function openPreview() {
  await mount();
  const trigger = byText("AI 自动打标签");
  expect(trigger).toBeDefined();
  await act(async () => {
    trigger?.click();
  });
  await flush();
}

beforeEach(() => {
  /* 故意让 steam 的时长更大：应用侧按累计时长倒序发，常用的先出结果、
     预览也先看到它们（断言 c01 的顺序就钉这一条）。 */
  g.apps = [
    { exeName: "code.exe", appName: "VS Code", totalDuration: 120_000 },
    { exeName: "steam.exe", appName: "Steam", totalDuration: 900_000 },
  ];
  g.items = [
    { id: 7, name: "写周报", isSystem: false },
    { id: 9, name: "未归类", isSystem: true },
  ];
  g.definitions = ["工作", "学习"];
  g.itemTags = [{ itemId: 7, tags: ["工作/日报"] }];
  g.appTags = { "code.exe": [] };
  g.enabled = { enabled: true, appTagsEnabled: true, itemTagsEnabled: true };
  g.suggest = vi.fn(async (request: { mode: string }) => response(request.mode));
  g.applyPlan = vi.fn(async () => ({ apps: 1, items: 1, failed: 0 }));
  g.persistDefinitions = vi.fn(async () => 0);
  g.notices = [];
  g.applied = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("AI 自动打标签 · 接线", () => {
  it("c01_asks_both_modes_with_the_same_candidate_catalog_and_skips_system_items", async () => {
    await openPreview();
    expect(g.suggest).toHaveBeenCalledTimes(2);
    const [appCall, itemCall] = g.suggest.mock.calls.map((call) => call[0] as {
      mode: string;
      targets: Array<{ id: string; text: string }>;
      candidates: Array<{ key: string; label: string }>;
    });
    expect(appCall.mode).toBe("app");
    expect(itemCall.mode).toBe("item");
    /* 应用侧文本是「名字 / exe」：中文名往往就是标签语义，exe 兜住同名的不同程序。
       顺序按累计时长倒序（steam 900s > code 120s）—— 后端每 40 个一批顺序发，
       常用的先出结果，别让"最常用的那个"排在第八批。 */
    expect(appCall.targets).toEqual([
      { id: "steam.exe", text: "Steam / steam.exe" },
      { id: "code.exe", text: "VS Code / code.exe" },
    ]);
    /* 系统项「未归类」不参与：给它打标签没有意义，写进去还会污染标签树 */
    expect(itemCall.targets).toEqual([{ id: "7", text: "写周报" }]);
    /* 候选是「定义行 ∪ 事项标签 ∪ 应用标签」的并集 —— 少了任何一路，AI 就会去新建
       一个本来已经存在的标签 */
    expect(itemCall.candidates.map((candidate) => candidate.label)).toEqual(["工作", "工作/日报", "学习"]);
    expect(appCall.candidates).toEqual(itemCall.candidates);
  });

  it("c02_preview_defaults_to_the_model_suggestion_and_shows_removals", async () => {
    await openPreview();
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    /* 事项 7 原来有「工作/日报」、模型建议「学习」：默认只勾「学习」，
       旧标签仍在 DOM 里（标了「原有」），否则用户看不见"要被删掉的是什么"。 */
    const chips = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    const byLabel = (label: string) => chips.find((chip) => (chip.textContent ?? "").includes(label));
    expect(byLabel("#学习")?.getAttribute("aria-pressed")).toBe("true");
    const legacy = byLabel("工作/日报");
    expect(legacy).toBeDefined();
    expect(legacy?.getAttribute("aria-pressed")).toBe("false");
    expect(legacy?.textContent).toContain("原有");
    /* 两个对象都有建议 → 底部计数是 2 */
    expect(byText("应用（2）")).toBeDefined();
    /* 模型新建的标签要在预览里点名（用户得知道 AI 打算造一个新标签） */
    expect(dialog.textContent).toContain("学习/考公");
  });

  it("c03_apply_splits_the_two_write_surfaces_and_reports_once", async () => {
    await openPreview();
    const apply = byText("应用（2）");
    expect(apply).toBeDefined();
    await act(async () => {
      apply?.click();
    });
    await flush();

    expect(g.persistDefinitions).toHaveBeenCalledWith(["学习/考公"]);
    const plan = g.applyPlan.mock.calls[0][0] as {
      apps: Array<{ exeName: string; tags: string[] }>;
      items: Array<{ itemId: number; tags: string[] }>;
    };
    expect(plan.apps).toEqual([{ exeName: "code.exe", tags: ["工作"] }]);
    expect(plan.items).toEqual([{ itemId: 7, tags: ["学习"] }]);
    expect(g.applied).toBe(1);
    expect(g.notices.at(-1)).toEqual({
      text: "已给 1 个应用、1 个事项写入标签",
      tone: "ok",
    });
  });

  it("c04_unchecking_every_chip_is_a_visible_clear_not_a_silent_skip", async () => {
    await openPreview();
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    const legacy = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"))
      .find((chip) => (chip.textContent ?? "").includes("#学习"));
    await act(async () => {
      legacy?.click();
    });
    await flush();
    /* 全摘掉 → 明确写出"将清空原有标签"，并且仍然计入写入条数（空数组 = 清空） */
    expect(dialog.textContent).toContain("将清空原有标签");
    const apply = byText("应用（2）");
    await act(async () => {
      apply?.click();
    });
    await flush();
    const plan = g.applyPlan.mock.calls[0][0] as { items: Array<{ itemId: number; tags: string[] }> };
    expect(plan.items).toEqual([{ itemId: 7, tags: [] }]);
  });

  it("c05_both_switches_off_explains_where_to_turn_them_on_instead_of_failing", async () => {
    g.enabled = { enabled: true, appTagsEnabled: false, itemTagsEnabled: false };
    await mount();
    const trigger = byText("AI 自动打标签");
    await act(async () => {
      trigger?.click();
    });
    await flush();
    expect(g.suggest).not.toHaveBeenCalled();
    expect(g.notices.at(-1)?.tone).toBe("error");
    expect(g.notices.at(-1)?.text).toContain("设置 → AI");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("c06_no_suggestion_at_all_stays_out_of_the_preview", async () => {
    g.suggest = vi.fn(async () => ({
      suggestions: [],
      stats: { parsed: 0, dropped: 2, attempts: 1, batches: 1, failedBatches: 0 },
      created: [],
    }));
    await mount();
    const trigger = byText("AI 自动打标签");
    await act(async () => {
      trigger?.click();
    });
    await flush();
    expect(g.notices.at(-1)).toEqual({ text: "AI 没有给出可用的标签建议", tone: "error" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(g.applyPlan).not.toHaveBeenCalled();
  });

  it("c07_master_switch_off_points_at_the_master_switch_not_the_two_sub_toggles", async () => {
    /* 总开关关着时两个子开关的状态没有意义。提示必须指向总开关 ——
       指错了用户会去翻「应用标签 / 事项标签」，翻完照样不行（`require_ready` 先看总开关）。 */
    g.enabled = { enabled: false, appTagsEnabled: true, itemTagsEnabled: true };
    await mount();
    const trigger = byText("AI 自动打标签");
    await act(async () => {
      trigger?.click();
    });
    await flush();
    expect(g.suggest).not.toHaveBeenCalled();
    expect(g.notices.at(-1)?.text).toContain("还没启用");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("c08_one_side_failing_keeps_the_other_side_result", async () => {
    /* 网络抖一下不该让整批白跑：应用侧抛错时，事项侧的建议仍要进预览，
       只用一句提示说明"这一侧先不写"。 */
    g.suggest = vi.fn(async (request: { mode: string }) => {
      if (request.mode === "app") throw new Error("频率限制");
      return response("item");
    });
    await mount();
    const trigger = byText("AI 自动打标签");
    await act(async () => {
      trigger?.click();
    });
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("写周报");
    expect(dialog?.textContent).not.toContain("Steam");
    expect(g.notices.at(-1)?.text).toContain("应用侧失败");
    expect(g.notices.at(-1)?.text).toContain("频率限制");
  });
});
