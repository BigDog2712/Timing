import { describe, expect, it } from "vitest";
import { computeDrop, placeCards } from "./gridFlow";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import type { LayoutCard } from "./contract";

/**
 * [拖拽排序 · 0.12.1末] 网格流式排布纯函数的判据。
 *
 * 为什么必须有：CSS `dense` 的补位是浏览器算的，React 拿不到「第几行」。拖拽
 * 「让位」必须自己复现这套算法，否则松手后卡序和屏幕看到的不一致。这里钉住两件事：
 *   ① placeCards 复现 dense 落点（半宽卡并排、放不下落到下一行）；
 *   ② computeDrop 把卡抽出后按目标格插回正确位置，并吸附 x 到能放下的列。
 */

describe("placeCards（dense 落点复现）", () => {
  it("默认布局的落点与设计一致", () => {
    /* timer(x0w2) apps(x2w2) 同第一行；items(x0w2) 落第二行左；
     * todos(x2w2 h2) 占二三行右；notes(x0w4) 通栏落第四行。 */
    const placed = placeCards(DEFAULT_LAYOUT.cards);
    expect(placed.map((p) => [p.id, p.row])).toEqual([
      ["timer", 0], ["apps", 0], ["items", 1], ["todos", 1], ["notes", 3],
    ]);
  });

  it("同列连续卡逐行下推（x 相同不放同一行）", () => {
    const cards: LayoutCard[] = [
      { id: "timer", x: 0, w: 1, h: 1, tier: "M" },
      { id: "apps", x: 0, w: 1, h: 1, tier: "M" },
      { id: "items", x: 0, w: 1, h: 1, tier: "M" },
    ];
    const placed = placeCards(cards);
    expect(placed.map((p) => p.row)).toEqual([0, 1, 2]);
  });

  it("放不下当前行时落到下一行 x=0 起找空", () => {
    const cards: LayoutCard[] = [
      { id: "timer", x: 0, w: 4, h: 1, tier: "M" },   // 占满第一行
      { id: "apps", x: 0, w: 2, h: 1, tier: "M" },    // 落到第二行
    ];
    const placed = placeCards(cards);
    expect(placed[0].row).toBe(0);
    expect(placed[1].row).toBe(1);
  });
});

describe("computeDrop（抽出 + 插回 + 吸附 x）", () => {
  it("把 timer 拖到 apps 前面（同行更左）", () => {
    /* 默认布局里 timer 在 apps 前。把 apps 拖到 timer 的格（col0 row0）→
     * apps 应插到 timer 之前。 */
    const { cards } = computeDrop(DEFAULT_LAYOUT.cards, "apps", 0, 0);
    expect(cards[0].id).toBe("apps");
    expect(cards[0].x).toBe(0);
  });

  it("拖到目标格时 x 吸附到能放下的列（w2 最右只能 x0..2）", () => {
    /* notes 是 w4，拖到 col3 时 x 必须夹回 0（w4 只能 x0）。 */
    const { cards } = computeDrop(DEFAULT_LAYOUT.cards, "notes", 3, 0);
    const notes = cards.find((c) => c.id === "notes")!;
    expect(notes.x).toBe(0);
  });

  it("拖到更下方时插到对应行首", () => {
    /* 抽出 timer 后其余卡 dense 重排，notes(w4) 落在行 3。拖 timer 到 (col0, row3)
     * = 插到 notes 之前（notes.x=0 >= col0，命中「同行同列或更右」）。 */
    const { cards } = computeDrop(DEFAULT_LAYOUT.cards, "timer", 0, 3);
    const idx = cards.findIndex((c) => c.id === "timer");
    expect(idx).toBe(cards.length - 2);
    expect(cards[cards.length - 1].id).toBe("notes");
  });

  it("不存在的 id 原样返回", () => {
    const { cards } = computeDrop(DEFAULT_LAYOUT.cards, "not-a-card" as never, 0, 0);
    expect(cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("抽出的卡不重复、不丢失", () => {
    const { cards } = computeDrop(DEFAULT_LAYOUT.cards, "items", 1, 1);
    expect(cards).toHaveLength(DEFAULT_LAYOUT.cards.length);
    expect(new Set(cards.map((c) => c.id)).size).toBe(DEFAULT_LAYOUT.cards.length);
  });
});
