import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async (_intent: unknown) => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  listTimingItemTags: vi.fn(async (): Promise<unknown[]> => []),
  saveAppItemBinding: vi.fn(async (_exe: string, _itemId: number | null) => undefined),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
  listTimingItemTags: h.listTimingItemTags,
}));
vi.mock("./appItemBinding.ts", () => ({ saveAppItemBinding: h.saveAppItemBinding }));

import { applyTodoItemExtras } from "./todoItemExtras.ts";

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  isSystem: false,
  ...over,
});

beforeEach(() => {
  h.emitHostIntent.mockClear();
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([]);
  h.listTimingItemTags.mockReset();
  h.listTimingItemTags.mockResolvedValue([]);
  h.saveAppItemBinding.mockClear();
});

describe("待办的标签 / 应用落点", () => {
  it("tx01_an_existing_same_name_item_gets_the_tags_and_the_binding", async () => {
    h.listTimingItems.mockResolvedValue([item(3, "写周报"), item(9, "写周报")]);
    h.listTimingItemTags.mockResolvedValue([
      { itemId: 9, tags: ["日常"] },
      { itemId: 3, tags: ["旧的"] },
    ]);

    await applyTodoItemExtras(" 写周报 ", { tags: ["工作"], appKey: "code.exe" });

    /* 同名多条时取最新那条（id 最大），与宿主按标题匹配的口径一致 */
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "update_item",
      id: 9,
      tags: ["日常", "工作"],
    });
    expect(h.saveAppItemBinding).toHaveBeenCalledWith("code.exe", 9);
  });

  it("tx01b_unreadable_existing_tags_do_not_get_overwritten", async () => {
    h.listTimingItems.mockResolvedValue([item(9, "写周报")]);
    h.listTimingItemTags.mockRejectedValue(new Error("ipc down"));

    await applyTodoItemExtras("写周报", { tags: ["工作"], appKey: null });

    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });

  it("tx02_without_an_item_it_creates_a_same_name_item_with_both_extras", async () => {
    await applyTodoItemExtras("写周报", { tags: ["工作"], appKey: "code.exe" });

    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "create_item",
      name: "写周报",
      tags: ["工作"],
      appKey: "code.exe",
    });
    expect(h.saveAppItemBinding).not.toHaveBeenCalled();
  });

  it("tx03_system_items_are_never_reused_or_created_over", async () => {
    h.listTimingItems.mockResolvedValue([item(1, "未归类", { isSystem: true })]);

    await applyTodoItemExtras("未归类", { tags: ["工作"], appKey: null });

    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: "create_item", name: "未归类", tags: ["工作"] });
  });

  it("tx04_no_extras_means_no_item_read_and_no_intent", async () => {
    await applyTodoItemExtras("写周报", { tags: [], appKey: null });

    expect(h.listTimingItems).not.toHaveBeenCalled();
    expect(h.listTimingItemTags).not.toHaveBeenCalled();
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });
});
