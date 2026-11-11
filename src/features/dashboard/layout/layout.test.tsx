import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampCardHeight, columnRowTokens, LAYOUT_STORAGE_KEY, MAX_CARD_HEIGHT, MIN_CARD_HEIGHT } from "./contract";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import { normalizeLayout } from "./normalizeLayout";
import { loadLayout, resetLayout, saveLayout } from "./layoutStore";

/**
 * [P1 · 0.12.1] B4 的判据：坏布局不许让主界面空着，也不许静默改用户排布。
 * 每条都用**不同**的坏输入，避免「一条用例顺带覆盖五种」的假绿。
 */
describe("normalizeLayout", () => {
  it("b04a_non_object_falls_back_to_default", () => {
    const result = normalizeLayout("not-a-layout");
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("not-an-object");
    expect(result.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("b04b_version_mismatch_falls_back_to_default", () => {
    const result = normalizeLayout({ version: 999, cards: DEFAULT_LAYOUT.cards });
    expect(result.reason).toBe("version-mismatch");
    expect(result.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("b04c_unknown_id_and_duplicate_are_dropped_without_losing_the_rest", () => {
    const result = normalizeLayout({
      version: 1,
      cards: [
        { id: "timer", column: "left", tier: "M" },
        { id: "not-a-card", column: "left", tier: "M" },
        { id: "timer", column: "left", tier: "M" },
        { id: "notes", column: "full", tier: "S" },
      ],
    });
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("unknown-card-id");
    expect(result.layout.cards.map((card) => card.id)).toEqual(["timer", "notes"]);
  });

  it("b04d_illegal_tier_and_column_are_repaired_in_place", () => {
    const result = normalizeLayout({
      version: 1,
      cards: [
        { id: "timer", column: "full", tier: "XL" },
        { id: "notes", column: "left", tier: "M" },
      ],
    });
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("illegal-column");
    /* 行内卡不许通栏、通栏卡不许进列；非法档回 M，不删卡。 */
    expect(result.layout.cards).toEqual([
      { id: "timer", column: "left", tier: "M" },
      { id: "notes", column: "full", tier: "M" },
    ]);
  });

  it("b04e_empty_cards_falls_back_to_default", () => {
    const result = normalizeLayout({ version: 1, cards: [] });
    expect(result.reason).toBe("empty-cards");
    expect(result.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("b04f_valid_layout_is_passed_through_untouched", () => {
    const input = {
      version: 1 as const,
      cards: [
        { id: "apps", column: "left" as const, tier: "L" as const },
        { id: "timer", column: "right" as const, tier: "S" as const },
      ],
    };
    const result = normalizeLayout(input);
    expect(result.repaired).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.layout.cards).toEqual(input.cards);
  });
});

describe("columnRowTokens", () => {
  it("b01a_default_layout_reproduces_today_grid_rows_verbatim", () => {
    const left = columnRowTokens(DEFAULT_LAYOUT.cards.filter((card) => card.column === "left"));
    const right = columnRowTokens(DEFAULT_LAYOUT.cards.filter((card) => card.column === "right"));
    /* 与 `.qp-col-left/right` 的令牌序列逐字相同；外面那层 minmax(0, …) 是防溢出用的，见 contract.ts */
    expect(left).toEqual(["minmax(0, var(--qp-mod-timer))", "minmax(0, var(--qp-mod-items))"]);
    expect(right).toEqual(["minmax(0, var(--qp-mod-apps))", "minmax(0, var(--qp-mod-todos))"]);
  });
});

describe("拖拽调整大小（0.12.1）", () => {
  it("r01a_dragged_height_wins_over_the_tier_token", () => {
    const rows = columnRowTokens([
      { id: "timer", column: "left", tier: "M", height: 300 },
      { id: "items", column: "left", tier: "M" },
    ]);
    expect(rows).toEqual(["minmax(0, 300px)", "minmax(0, var(--qp-mod-items))"]);
  });

  it("r01b_out_of_range_heights_are_clamped_not_dropped", () => {
    expect(clampCardHeight(20)).toBe(MIN_CARD_HEIGHT);
    expect(clampCardHeight(9_999)).toBe(MAX_CARD_HEIGHT);
    expect(clampCardHeight(Number.NaN)).toBe(MIN_CARD_HEIGHT);
    /* 越界值在自愈时被夹住，卡还在 */
    const result = normalizeLayout({
      version: 1,
      cards: [{ id: "timer", column: "left", tier: "M", height: 12 }],
    });
    expect(result.layout.cards[0].height).toBe(MIN_CARD_HEIGHT);
  });

  it("r01c_broken_height_falls_back_to_the_tier_token_without_dropping_the_card", () => {
    const result = normalizeLayout({
      version: 1,
      cards: [{ id: "timer", column: "left", tier: "M", height: "300" }],
    });
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("illegal-height");
    expect(result.layout.cards).toHaveLength(1);
    expect(result.layout.cards[0].height).toBeUndefined();
  });
});

describe("layoutStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("b03a_save_then_load_round_trips_without_drift", () => {
    const layout = { version: 1 as const, cards: [{ id: "todos" as const, column: "right" as const, tier: "L" as const }] };
    saveLayout(layout);
    const loaded = loadLayout();
    expect(loaded.repaired).toBe(false);
    expect(loaded.layout.cards).toEqual(layout.cards);
  });

  it("b04g_invalid_json_is_repaired_and_written_back_once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{");
    const loaded = loadLayout();
    expect(loaded.reason).toBe("invalid-json");
    expect(loaded.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
    /* 回写过：下一次读不该再自愈，否则每次启动都 warn 一条。 */
    const again = loadLayout();
    expect(again.repaired).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("b04h_first_run_does_not_write_storage", () => {
    resetLayout();
    const loaded = loadLayout();
    expect(loaded.repaired).toBe(false);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
  });
});
