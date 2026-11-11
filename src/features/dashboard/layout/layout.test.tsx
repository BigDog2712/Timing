import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampCardHeight,
  clampCardWidth,
  columnSpan,
  DEFAULT_CARD_WIDTH,
  LAYOUT_STORAGE_KEY,
  MAX_CARD_HEIGHT,
  MAX_SPLIT,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  MIN_SPLIT,
} from "./contract";
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
        /* 行内卡的合法列现在是三档（left / right / **full**，0.12.1 起支持跨列），
         * 所以这里用 "middle" 这种压根不是列的串来触发 illegal-column。 */
        { id: "timer", column: "middle", tier: "XL" },
        { id: "notes", column: "left", tier: "M" },
      ],
    });
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("illegal-column");
    /* 非法列回 left / full；通栏卡不许进列；非法档回 M，不删卡。 */
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

/**
 * [单独宽度 · 0.12.1] 宽度是「自己那一列占几格」。
 *
 * 行/列两条轴各管各的：`split` 决定两列多宽（全局一个数），`width` 决定一张卡在这一列里
 * 占四分之几（每卡一个数）。混成一个数的话，窗口换宽就要重算，且两者抢同一块空间。
 */
describe("单独宽度", () => {
  it("w01a_width_snaps_to_quarters_and_never_leaves_the_column", () => {
    expect(clampCardWidth(37)).toBe(25);
    expect(clampCardWidth(38)).toBe(50);
    expect(clampCardWidth(0)).toBe(MIN_CARD_WIDTH);
    expect(clampCardWidth(9_999)).toBe(DEFAULT_CARD_WIDTH);
    expect(clampCardWidth(Number.NaN)).toBe(DEFAULT_CARD_WIDTH);
  });

  it("w01b_span_is_the_quarter_count_and_defaults_to_a_full_column", () => {
    expect(columnSpan(undefined)).toBe(4);
    expect(columnSpan(100)).toBe(4);
    expect(columnSpan(75)).toBe(3);
    expect(columnSpan(50)).toBe(2);
    expect(columnSpan(25)).toBe(1);
  });

  it("w01c_stored_width_is_snapped_and_full_width_is_not_persisted", () => {
    const snapped = normalizeLayout({
      version: 1,
      cards: [{ id: "timer", column: "left", tier: "M", width: 37 }],
    });
    expect(snapped.layout.cards[0].width).toBe(25);
    expect(snapped.repaired).toBe(true);
    /* 100 = 缺省。写进布局会让「恢复默认」永远判成"已自定义"，也会让老布局多一次无谓自愈 */
    const full = normalizeLayout({
      version: 1,
      cards: [{ id: "timer", column: "left", tier: "M", width: 100 }],
    });
    expect(full.layout.cards[0].width).toBeUndefined();
    expect(full.repaired).toBe(false);
  });
});

describe("拖拽调整大小（0.12.1）", () => {
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

/**
 * [列宽比可拖 / 卡片跨列 · 0.12.1] 三条判据，各钉一处**会静默失效**的接线。
 *
 * 为什么必须钉：这两项都不改变默认画面的一个像素，光看截图分不出"做了"和"没做"，
 * 而失效的方式又都是零报错（拖了没反应 / 刷新弹回去 / 比例不落盘）。
 */
describe("列宽比与跨列", () => {
  it("b04i_row_card_may_span_full_and_stays_spanning_after_reload", () => {
    /* 行内卡跨满是合法布局，**不许**被自愈压回 left —— 否则用户点「跨列」，
     * 刷新就弹回去，而界面上没有任何提示。 */
    const result = normalizeLayout({
      version: 1,
      cards: [
        { id: "timer", column: "full", tier: "M" },
        { id: "apps", column: "full", tier: "M" },
      ],
    });
    expect(result.repaired).toBe(false);
    expect(result.layout.cards.map((card) => card.column)).toEqual(["full", "full"]);
    /* 天生通栏的卡仍然不许进列，这条不变 */
    expect(normalizeLayout({
      version: 1,
      cards: [{ id: "notes", column: "left", tier: "M" }],
    }).layout.cards[0].column).toBe("full");
  });

  it("b04j_split_is_clamped_and_absent_split_is_not_a_repair", () => {
    const cards = [{ id: "timer", column: "left", tier: "M" as const }];
    /* 越界夹住：窗口再窄也不许把一列拖成 0 */
    expect(normalizeLayout({ version: 1, cards, split: 999 }).layout.split).toBe(MAX_SPLIT);
    expect(normalizeLayout({ version: 1, cards, split: -5 }).layout.split).toBe(MIN_SPLIT);
    /* 老布局没有 split 键：不能因此判"需自愈"（那会把用户的卡序一起重写一遍） */
    const legacy = normalizeLayout({ version: 1, cards });
    expect(legacy.repaired).toBe(false);
    expect(legacy.layout.split).toBeUndefined();
  });

  it("b04k_split_round_trips_through_storage", () => {
    saveLayout({ version: 1, cards: DEFAULT_LAYOUT.cards, split: 55 });
    expect(loadLayout().layout.split).toBe(55);
  });
});
