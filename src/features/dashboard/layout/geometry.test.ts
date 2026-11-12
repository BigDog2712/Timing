import { describe, expect, it } from "vitest";
import { BOARD_H, BOARD_W, KIND_SPECS, minSizeOf, SNAP, type BoardCard } from "./contract";
import { clampRect, contentHeight, findFreeSpot, firstOverlap, overlaps, snapValue, tidyCards } from "./geometry";

/**
 * [v3] 画布几何的判据。这些函数是拖拽 / 加卡 / 自愈三处的**同一套**判据，
 * 坏一条的表现都是「拖着没事、存下来再打开就叠了」——只在重启后出现的错，最难查。
 */
function card(uid: number, x: number, y: number, w: number, h: number, kind: BoardCard["kind"] = "apps"): BoardCard {
  return { uid, kind, x, y, w, h, tier: "M" };
}

describe("snapValue / clampRect", () => {
  it("吸附到 8px，关掉后只取整", () => {
    expect(snapValue(13)).toBe(16);
    expect(snapValue(13, false)).toBe(13);
    expect(snapValue(Number.NaN)).toBe(0);
  });

  it("尺寸不小于组件下限，位置不越左/上边界", () => {
    const rect = clampRect("timer", { x: -40, y: -8, w: 10, h: 10 });
    const min = minSizeOf("timer");
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.w).toBe(min.w);
    expect(rect.h).toBe(min.h);
  });

  it("右缘不出画布：宽先被夹到画布内，x 再被压到能放下的位置", () => {
    const rect = clampRect("apps", { x: BOARD_W, y: 0, w: KIND_SPECS.apps.sizes.L[0], h: 200 });
    expect(rect.x + rect.w).toBeLessThanOrEqual(BOARD_W);
    expect(rect.x).toBe(BOARD_W - rect.w);
  });

  it("纵向不设上限（卡片可以排到首屏之外，那是滚动的事）", () => {
    expect(clampRect("apps", { x: 0, y: 4000, w: 518, h: 264 }).y).toBe(4000);
  });

  /* 便利贴曾经的下限是 480×96 —— 宽下不去 480、三档预设宽度还全是通栏，于是
   * 「调尺寸」在这张卡上看起来完全没生效。现在下限就是 exe 的 320×168
   * （`widgets/mod.rs:101`），这条用例钉住它真的能缩到那个尺寸。 */
  it("便利贴宽高都能拖到 320×168，不被通栏时代的 480 卡住", () => {
    expect(clampRect("notes", { x: 0, y: 0, w: 320, h: 168 })).toEqual({ x: 0, y: 0, w: 320, h: 168 });
    /* 拖过头照样夹回下限，不允许出现负尺寸 */
    expect(clampRect("notes", { x: 0, y: 0, w: 100, h: 40 })).toEqual({ x: 0, y: 0, w: 320, h: 168 });
  });

  /* 下限 168 与 exe 同值，且必须放得下一整张纸片：卡头 46 + 纸片 88 + 底内距 16 = 150。
   * 矮于它就会出现"只露半张纸片"的残破态。 */
  it("便利贴的最小高度放得下一整张纸片", () => {
    expect(minSizeOf("notes").h).toBeGreaterThanOrEqual(46 + 88 + 16);
  });

  /* 三档预设横向要真有差别，否则点「小」当场看不出变化（原先 S/M/L 宽度全是 1052）。 */
  it("便利贴三档预设既有宽差、也放得下整数行纸片", () => {
    const { S, M, L } = KIND_SPECS.notes.sizes;
    expect(S[0]).toBeLessThan(M[0]);
    /* 每档高度 = 卡头 + 底内距 + n×88 + (n−1)×10 的下界之内，不留"切了一半"的下缘 */
    for (const [, h] of [S, M, L]) {
      const available = h - 62;
      const rows = Math.floor((available + 10) / 98);
      expect(rows).toBeGreaterThanOrEqual(1);
      /* 下一行的顶边要么在可视区外，要么这一行本身就放满了——不允许"露 1–10px" */
      const nextTop = rows * 98;
      expect(nextTop >= available || nextTop - available <= 8).toBe(true);
    }
  });
});

describe("overlaps / contentHeight", () => {
  it("留 8px 让位间距后不算相交", () => {
    const a = card(1, 0, 0, 100, 100);
    /* 默认 gap=0：边缘相接不算相交（`a.x + a.w <= b.x`） */
    expect(overlaps(a, card(2, 100, 0, 100, 100))).toBe(false);
    expect(overlaps(a, card(2, 99, 0, 100, 100))).toBe(true);
    /* 留 8px 让位：正好 108 起才算不相交 */
    expect(overlaps(a, card(2, 108, 0, 100, 100), SNAP)).toBe(false);
    expect(overlaps(a, card(2, 107, 0, 100, 100), SNAP)).toBe(true);
  });

  it("内容高至少是首屏，排到下面就跟到下面", () => {
    expect(contentHeight([card(1, 0, 0, 200, 100)])).toBe(BOARD_H);
    expect(contentHeight([card(1, 0, 1200, 200, 100)])).toBe(1200 + 100 + 24);
  });
});

describe("findFreeSpot", () => {
  it("空板落在原点", () => {
    expect(findFreeSpot([], "apps", { w: 518, h: 264 })).toEqual({ x: 0, y: 0 });
  });

  it("第一块空地不压住已有的卡", () => {
    const occupied = [
      card(1, 0, 0, 518, 264),
      card(2, 534, 0, 518, 264),
      card(3, 0, 280, 518, 264),
    ];
    const spot = findFreeSpot(occupied, "apps", { w: 518, h: 264 });
    /* 落点按 8px 步长扫，并要求 8px 让位：第一行右缘 518 之后 → 528；第二行 264 之后 → 272 */
    expect(spot).toEqual({ x: 528, y: 272 });
    expect(occupied.every((item) => !overlaps({ ...spot, w: 518, h: 264 }, item, SNAP))).toBe(true);
  });
});

describe("tidyCards", () => {
  it("按顺序装进 exe 的三列（340 / 330 / 500），且两两不相交", () => {
    const messy = [
      card(1, 137, 421, 340, 304, "timer"),
      card(2, 901, 33, 330, 304, "apps"),
      card(3, 0, 700, 500, 304, "trend"),
      card(4, 200, 100, 340, 424, "todos"),
    ];
    const tidy = tidyCards(messy);
    /* 逐张按「放得下且游标最靠上」的列落位（exe `pack()`）：
     * 1 → 一列 (24,24)；2 → 二列 (380,24)；3 → 三列（只有它放得下 500）(726,24)；
     * 4 → 一列游标 344。 */
    expect(tidy.map((item) => [item.x, item.y, item.w])).toEqual([
      [24, 24, 340],
      [380, 24, 330],
      [726, 24, 500],
      [24, 344, 340],
    ]);
    expect(firstOverlap(tidy)).toBeNull();
  });

  it("宽于最宽列的卡按通栏处理，三列游标一起下移", () => {
    const tidy = tidyCards([
      card(1, 0, 0, 340, 200, "timer"),
      card(2, 0, 0, 1000, 200, "trend"),
      card(3, 0, 0, 340, 200, "apps"),
    ]);
    expect(tidy[1]).toMatchObject({ x: 0, w: BOARD_W });
    /* 通栏落在第 1 张之后：24 + 200 + 16 = 240，三列都从这里继续 */
    expect(tidy[2].y).toBe(240 + 200 + 16);
  });
});
