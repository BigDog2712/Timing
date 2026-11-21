(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 上区「一键 AI 分类」的**写入纪律**（0.12.6 · T4 · PRD P0-6）。
 *
 * 五条，全都是"写错了库里有痕迹"的事：
 *   ① 只把 `tags.length === 0` 的事项发给模型 —— 已打标的**不进请求**（不被覆盖的前提）；
 *   ② 取消 = 零写入（预览不是写入的借口）；
 *   ③ 预览里摘掉的行不写（`selection` 里没有它就等于"没动"）；
 *   ④ 落库后报条数，并留一次整体撤销（**整份覆盖**写回空数组 = 打标前状态；代价写在
 *      `title`/`aria-label` 里，因为中途手动加的标签也会被一起清掉）；
 *   ⑤ 没有未打标事项时置灰并**说清原因**（点了也有一句 toast）。
 *
 * 所有写库都经 `emitHostIntent`（分析窗没有 `set_item_tags`），所以这里断言的是**意图**：
 * 意图条数与载荷，就是"写了什么"。
 */
const h = vi.hoisted(() => ({
  listTimingItemTags: vi.fn(async (): Promise<unknown[]> => []),
  listTagDefinitions: vi.fn(async (): Promise<string[]> => ["工作", "生活"]),
  createTagDefinition: vi.fn(async (): Promise<string[]> => []),
  aiConfigGet: vi.fn(async (): Promise<unknown> => ({
    config: { enabled: true, itemTagsEnabled: true, appTagsEnabled: true },
    hasKey: true,
    secretAvailable: true,
  })),
  /* `_request` 有名字只是为了在断言里能读 `mock.calls[0][0]`（请求载荷就是"发给了谁"） */
  aiSuggestTags: vi.fn(async (_request: unknown): Promise<unknown> => ({
    suggestions: [],
    stats: { parsed: 0, dropped: 0, attempts: 1 },
  })),
  emitHostIntent: vi.fn(async (): Promise<boolean> => true),
}));

vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItemTags: h.listTimingItemTags,
}));
vi.mock("../../../platform/persistence/tagAdminGateway.ts", () => ({
  listTagDefinitions: h.listTagDefinitions,
  createTagDefinition: h.createTagDefinition,
}));
vi.mock("../../../platform/desktop/hostAiGateway.ts", () => ({
  aiConfigGet: h.aiConfigGet,
  aiSuggestTags: h.aiSuggestTags,
}));
vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({
  emitHostIntent: h.emitHostIntent,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import ItemsAiTagButton from "./ItemsAiTagButton.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let toasts: Array<{ text: string; tone?: string }> = [];
let applied = 0;

function item(id: number, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    color: "",
    isSystem: false,
    isPinned: false,
    sortOrder: 0,
    updatedAt: 0,
    categoryKey: null,
    ...over,
  };
}

const ITEMS = [item(1, "写周报"), item(2, "吃饭"), item(3, "未归类", { isSystem: true })];

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(items = ITEMS) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(ItemsAiTagButton, {
        items,
        onApplied: () => { applied += 1; },
        onToast: (text: string, tone?: string) => { toasts.push({ text, tone }); },
      }),
    }));
  });
  await flush();
}

const aiButton = () => container?.querySelector<HTMLButtonElement>(".at-items-zone-ai") ?? null;
const undoButton = () => container?.querySelector<HTMLButtonElement>(".at-items-zone-undo") ?? null;
const dialogRows = () => Array.from(document.body.querySelectorAll<HTMLElement>(".at-items-ai-row"));
const dialogButtons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>(".at-dialog-surface button"));
const buttonByText = (text: string) =>
  dialogButtons().find((button) => button.textContent?.trim() === text) ?? null;

/** 让 AI 给 1、2 各一条建议，然后打开预览层。 */
async function openPreview(suggestions = [
  { id: "1", tags: ["工作/写周报"] },
  { id: "2", tags: ["生活/吃饭"] },
]) {
  h.aiSuggestTags.mockResolvedValue({ suggestions, stats: { parsed: 2, dropped: 0, attempts: 1 } });
  await act(async () => { aiButton()?.click(); });
  await flush();
}

beforeEach(() => {
  h.listTimingItemTags.mockReset();
  h.listTimingItemTags.mockResolvedValue([]);
  h.listTagDefinitions.mockReset();
  h.listTagDefinitions.mockResolvedValue(["工作", "生活"]);
  h.createTagDefinition.mockReset();
  h.createTagDefinition.mockResolvedValue([]);
  h.aiConfigGet.mockReset();
  h.aiConfigGet.mockResolvedValue({
    config: { enabled: true, itemTagsEnabled: true, appTagsEnabled: true },
    hasKey: true,
    secretAvailable: true,
  });
  h.aiSuggestTags.mockReset();
  h.aiSuggestTags.mockResolvedValue({ suggestions: [], stats: { parsed: 0, dropped: 0, attempts: 1 } });
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  toasts = [];
  applied = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.querySelectorAll(".at-dialog-backdrop").forEach((node) => node.remove());
});

describe("AI 一键分类 · 只补空白（P0-6）", () => {
  it("ia01_only_untagged_items_are_sent_to_the_model", async () => {
    h.listTimingItemTags.mockResolvedValue([{ itemId: 1, tags: ["工作/写周报"] }]);
    await mount();
    await openPreview([{ id: "2", tags: ["生活/吃饭"] }]);

    const request = h.aiSuggestTags.mock.calls[0][0] as { mode: string; targets: Array<{ id: string }> };
    expect(request.mode).toBe("item");
    /* 1 已经有标签 → 不进请求；3 是系统事项 → 永不参与 */
    expect(request.targets.map((target) => target.id)).toEqual(["2"]);
    expect(dialogRows().map((row) => row.querySelector(".at-items-ai-name")?.textContent)).toEqual(["吃饭"]);
  });

  it("ia02_cancelling_writes_nothing", async () => {
    await mount();
    await openPreview();
    expect(dialogRows()).toHaveLength(2);

    await act(async () => { buttonByText("取消")?.click(); });
    await flush();

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(h.createTagDefinition).not.toHaveBeenCalled();
    expect(applied).toBe(0);
  });

  it("ia03_an_unticked_row_is_not_written", async () => {
    await mount();
    await openPreview();
    const [first] = dialogRows();
    const check = first?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(check?.checked).toBe(true);
    await act(async () => { check?.click(); });
    await flush();

    /* 确认键上的数字就是"真会写出去的条数"：从 2 变 1 */
    expect(buttonByText("应用（1）")).not.toBeNull();
    await act(async () => { buttonByText("应用（1）")?.click(); });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "set_item_tags",
      itemId: 2,
      tags: ["生活/吃饭"],
    });
  });

  it("ia04_applying_reports_the_count_and_offers_one_undo", async () => {
    await mount();
    await openPreview();
    await act(async () => { buttonByText("应用（2）")?.click(); });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledTimes(2);
    expect(toasts.map((entry) => entry.text)).toContain("已写入 2 条");
    expect(applied).toBe(1);
    /* 预览层关掉、撤销入口出现 */
    expect(dialogRows()).toHaveLength(0);
    expect(undoButton()?.textContent).toBe("撤销本次分类");
    /* [M4] `set_item_tags` 是**整份覆盖**：撤销会把这批事项的标签整体清空，
       连「应用」之后用户手动加上去的那几条也一起清掉。代价只能写在 title/aria-label 里，
       因为按钮上只有四个字。`aria-label` 以可见文字开头，读屏念出的名字仍包含它（2.5.3）。 */
    expect(undoButton()?.getAttribute("title"), "撤销键没有说出代价").toBe("撤销本次分类（会清空这批事项的标签）");
    expect(undoButton()?.getAttribute("aria-label")).toBe("撤销本次分类（会清空这批事项的标签）");

    h.emitHostIntent.mockClear();
    await act(async () => { undoButton()?.click(); });
    await flush();

    /* 撤销 = 逐条写回空数组（参与分类的事项打标前都是空的） */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(2);
    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: "set_item_tags", itemId: 1, tags: [] });
    expect(toasts.map((entry) => entry.text)).toContain("已撤销 2 条分类");
    expect(undoButton()).toBeNull();
  });

  it("ia05_nothing_to_classify_greys_the_button_and_says_why", async () => {
    h.listTimingItemTags.mockResolvedValue([
      { itemId: 1, tags: ["工作/写周报"] },
      { itemId: 2, tags: ["生活/吃饭"] },
    ]);
    await mount();

    expect(aiButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(aiButton()?.getAttribute("title")).toBe("没有需要分类的事项");
    await act(async () => { aiButton()?.click(); });
    await flush();

    expect(h.aiSuggestTags).not.toHaveBeenCalled();
    expect(toasts.map((entry) => entry.text)).toEqual(["没有需要分类的事项"]);
  });

  it("ia06_without_ai_configuration_the_reason_says_so", async () => {
    h.aiConfigGet.mockResolvedValue({
      config: { enabled: false, itemTagsEnabled: false, appTagsEnabled: false },
      hasKey: false,
      secretAvailable: false,
    });
    await mount();

    expect(aiButton()?.getAttribute("title")).toBe("未配置 AI，去设置");
    await act(async () => { aiButton()?.click(); });
    await flush();
    expect(h.aiSuggestTags).not.toHaveBeenCalled();
    expect(toasts.map((entry) => entry.text)).toEqual(["未配置 AI，去设置"]);
  });

  it("ia07_a_memory_hit_skips_the_model_entirely", async () => {
    /* 库里已有「写周报 → 工作/周报」，待判的只多一个年份后缀。这类重复动作不该花钱：
       本地记忆直接给答案，仍然进预览、仍然可勾掉（不静默写入）。 */
    h.listTimingItemTags.mockResolvedValue([{ itemId: 1, tags: ["工作/周报"] }]);
    await mount([item(1, "写周报"), item(2, "写周报2024")]);

    await act(async () => { aiButton()?.click(); });
    await flush();

    expect(h.aiSuggestTags, "记忆命中却仍然调了模型").not.toHaveBeenCalled();
    expect(dialogRows()).toHaveLength(1);
    expect(dialogRows()[0]?.querySelector(".at-tag-chip")?.textContent).toBe("#工作/周报");
    expect(document.body.textContent).toContain("1 条来自本地记忆");
    /* 没调模型不等于失败：不该冒出一条"AI 没有给出建议" */
    expect(toasts.map((entry) => entry.text)).not.toContain("AI 没有给出可用的标签建议");
  });
});
