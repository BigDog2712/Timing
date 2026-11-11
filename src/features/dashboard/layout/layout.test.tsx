import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampH,
  clampW,
  clampX,
  LAYOUT_STORAGE_KEY,
  COLS,
  MAX_ROW_SPAN,
} from "./contract";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import { normalizeLayout } from "./normalizeLayout";
import { loadLayout, resetLayout, saveLayout } from "./layoutStore";

/**
 * [v2 · 0.12.1末] 网格布局的判据：坏布局不许让主界面空着，也不许静默改用户排布。
 * v1（column/split）直接回默认，不迁移。
 */
describe("normalizeLayout（网格 v2）", () => {
  it("非对象回默认", () => {
    const result = normalizeLayout("not-a-layout");
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("not-an-object");
    expect(result.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("版本不符（含 v1）回默认", () => {
    const v1 = normalizeLayout({ version: 1, cards: [{ id: "timer", column: "left", tier: "M" }] });
    expect(v1.reason).toBe("version-mismatch");
    expect(v1.layout.cards).toEqual(DEFAULT_LAYOUT.cards);

    const future = normalizeLayout({ version: 999, cards: DEFAULT_LAYOUT.cards });
    expect(future.reason).toBe("version-mismatch");
  });

  it("未知 id 与重复 id 被丢弃，不丢其余卡", () => {
    const result = normalizeLayout({
      version: 2,
      cards: [
        { id: "timer", x: 0, w: 2, h: 1, tier: "M" },
        { id: "not-a-card", x: 0, w: 1, h: 1, tier: "M" },
        { id: "timer", x: 1, w: 1, h: 1, tier: "M" },
        { id: "notes", x: 0, w: 4, h: 1, tier: "S" },
      ],
    });
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("unknown-card-id");
    expect(result.layout.cards.map((card) => card.id)).toEqual(["timer", "notes"]);
  });

  it("非法 x/w/h/tier 就地修正，不删卡", () => {
    const result = normalizeLayout({
      version: 2,
      cards: [
        { id: "timer", x: 9, w: 99, h: 9, tier: "XL" },
      ],
    });
    expect(result.repaired).toBe(true);
    expect(result.reason).toBe("illegal-x");
    expect(result.layout.cards[0].x).toBe(COLS - 1);
    /* w 被 x 挤压到能放下的最大宽 */
    expect(result.layout.cards[0].w).toBe(1);
    expect(result.layout.cards[0].h).toBe(MAX_ROW_SPAN);
    expect(result.layout.cards[0].tier).toBe("M");
  });

  it("空卡表回默认", () => {
    const result = normalizeLayout({ version: 2, cards: [] });
    expect(result.reason).toBe("empty-cards");
    expect(result.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("合法布局原样通过", () => {
    const input = {
      version: 2 as const,
      cards: [
        { id: "apps" as const, x: 2, w: 2, h: 1, tier: "L" as const },
        { id: "timer" as const, x: 0, w: 2, h: 1, tier: "S" as const },
      ],
    };
    const result = normalizeLayout(input);
    expect(result.repaired).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.layout.cards).toEqual(input.cards);
  });
});

describe("网格坐标钳制（v2）", () => {
  it("clampX 夹到 [0, COLS-1]", () => {
    expect(clampX(-1)).toBe(0);
    expect(clampX(0)).toBe(0);
    expect(clampX(99)).toBe(COLS - 1);
    expect(clampX(Number.NaN)).toBe(0);
  });

  it("clampW 夹到 [1, COLS-x]，x+w 不越界", () => {
    expect(clampW(0, 0)).toBe(1);
    expect(clampW(1, 0)).toBe(1);
    expect(clampW(4, 0)).toBe(4);
    expect(clampW(5, 0)).toBe(4);
    /* x=3 时最多 w=1 */
    expect(clampW(4, 3)).toBe(1);
    expect(clampW(Number.NaN, 0)).toBe(1);
  });

  it("clampH 夹到 [1, MAX_ROW_SPAN]", () => {
    expect(clampH(0)).toBe(1);
    expect(clampH(1)).toBe(1);
    expect(clampH(2)).toBe(2);
    expect(clampH(99)).toBe(MAX_ROW_SPAN);
    expect(clampH(Number.NaN)).toBe(1);
  });
});

describe("layoutStore（v2）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("保存后读回无漂移", () => {
    const layout = { version: 2 as const, cards: [{ id: "todos" as const, x: 2, w: 2, h: 2, tier: "L" as const }] };
    saveLayout(layout);
    const loaded = loadLayout();
    expect(loaded.repaired).toBe(false);
    expect(loaded.layout.cards).toEqual(layout.cards);
  });

  it("坏 JSON 自愈并回写一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{");
    const loaded = loadLayout();
    expect(loaded.reason).toBe("invalid-json");
    expect(loaded.layout.cards).toEqual(DEFAULT_LAYOUT.cards);
    const again = loadLayout();
    expect(again.repaired).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("首次运行不写盘", () => {
    resetLayout();
    const loaded = loadLayout();
    expect(loaded.repaired).toBe(false);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
  });
});
