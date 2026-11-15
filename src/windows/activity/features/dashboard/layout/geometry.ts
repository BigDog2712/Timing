/**
 * [v3] 画布几何：吸附、夹紧、找空地、整理。**纯函数**，不碰 store / DOM。
 *
 * 放在这里的理由：拖拽（`useBoardDrag`）、加卡（`boardStore`）、自愈（`normalizeLayout`）
 * 三处都要用同一套「什么算合法矩形」的判据。三处各写一遍的话，表现是「拖着没事、
 * 存下来再打开就叠了」——这种只在重启后出现的错，最难查。
 */
import {
  BOARD_H,
  BOARD_W,
  COLUMNS,
  GAP,
  minSizeOf,
  PAD,
  SNAP,
  type BoardCard,
  type CardKind,
  type Rect,
} from "./contract";

/** 最宽那一列的列宽：比它还宽的卡按通栏处理（exe 没有这种卡，自由摆位有）。 */
const WIDEST_COL = COLUMNS.reduce((max, col) => Math.max(max, col.w), 0);

/** 是否吸附到 8px 网格。`on=false` 时只做整数化（避免半像素导致的 1px 抖动）。 */
export function snapValue(value: number, on = true): number {
  if (!Number.isFinite(value)) return 0;
  return on ? Math.round(value / SNAP) * SNAP : Math.round(value);
}

/**
 * 把任意矩形修成「合法、可渲染」的：尺寸不小于组件下限、不宽于画布，
 * 位置不越左/上边界、右缘不出画布。**纵向不设上限**：卡片可以排到首屏之外，
 * 那是滚动的事，不是数据的事。
 */
export function clampRect(kind: CardKind, rect: Rect, snapOn = true): Rect {
  const min = minSizeOf(kind);
  const w = Math.min(BOARD_W, Math.max(min.w, snapValue(rect.w, snapOn)));
  const h = Math.max(min.h, snapValue(rect.h, snapOn));
  const x = Math.min(BOARD_W - w, Math.max(0, snapValue(rect.x, snapOn)));
  const y = Math.max(0, snapValue(rect.y, snapOn));
  return { x, y, w, h };
}

/** 两个矩形是否相交（`gap` > 0 时留出让位间距，新建落点用 8）。 */
export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return !(
    a.x + a.w + gap <= b.x
    || b.x + b.w + gap <= a.x
    || a.y + a.h + gap <= b.y
    || b.y + b.h + gap <= a.y
  );
}

/** 画布内容高：至少 `BOARD_H`（首屏），有卡排到下面就跟到下面。 */
export function contentHeight(cards: readonly BoardCard[]): number {
  const bottom = cards.reduce((max, card) => Math.max(max, card.y + card.h), 0);
  return Math.max(BOARD_H, bottom + PAD);
}

/**
 * 给新卡找第一块能放下的空地：从左上往右下按 8px 步长扫。
 *
 * 为什么是扫描而不是「塞到最矮一列底部」：自由摆位下「列」不存在了，用户可能把卡摆成
 * 任意形状；按列塞会压住别人的卡。扫描的代价是 O(面积/64)，8 张卡时是微秒级。
 * 步长用 `SNAP` 而不是 1px：落点本来就吸附，1px 精度扫出来也会被吸附回去。
 */
export function findFreeSpot(
  cards: readonly BoardCard[],
  kind: CardKind,
  size: { w: number; h: number },
): { x: number; y: number } {
  const min = minSizeOf(kind);
  const w = Math.min(BOARD_W, Math.max(min.w, size.w));
  const h = Math.max(min.h, size.h);
  const maxX = Math.max(0, BOARD_W - w);

  for (let y = 0; y <= 4000; y += SNAP) {
    for (let x = 0; x <= maxX; x += SNAP) {
      const probe = { x, y, w, h };
      if (!cards.some((card) => overlaps(probe, card, SNAP))) {
        return { x, y };
      }
    }
  }
  /* 4000 高还放不下（几十张卡才可能）：叠在最下面，至少不会消失。 */
  const bottom = cards.reduce((max, card) => Math.max(max, card.y + card.h), 0);
  return { x: 0, y: bottom + SNAP };
}

/**
 * 「整理」：按数组顺序重排成 **exe 的三列**（`layout.rs:402` 的 `pack`）。
 *
 * 判据与 exe 逐行同构：每张卡进"列宽放得下、且该列游标最靠上"的那一列（并列取左列），
 * 落位后游标下移 `h + GAP`。宽于 500 的卡（跨列通栏）两列游标一起下移 —— exe 里没有
 * 这个分支（它的卡都 ≤ 500），但自由摆位允许用户拉出通栏卡，整理时不能把它压回 500。
 *
 * 结果是「点一下整理」就回到 exe 的首屏排法，而不是另一套网格哲学。
 */
export function tidyCards(cards: readonly BoardCard[]): BoardCard[] {
  const cursor = COLUMNS.map(() => PAD);
  return cards.map((card) => {
    const wide = card.w > WIDEST_COL;
    if (wide) {
      const y = Math.max(...cursor);
      cursor.forEach((_, index) => { cursor[index] = y + card.h + GAP; });
      return { ...card, x: 0, y, w: BOARD_W };
    }
    let slot = -1;
    for (let index = 0; index < COLUMNS.length; index += 1) {
      if (COLUMNS[index].w + 0.5 < card.w) continue;
      if (slot < 0 || cursor[index] < cursor[slot]) slot = index;
    }
    if (slot < 0) slot = 0;
    const y = cursor[slot];
    cursor[slot] = y + card.h + GAP;
    return { ...card, x: COLUMNS[slot].x, y, w: Math.min(card.w, COLUMNS[slot].w) };
  });
}

/** 开发期断言用：两两不相交（不抛错，返回第一对冲突的 uid，供测试/日志）。 */
export function firstOverlap(cards: readonly BoardCard[]): [number, number] | null {
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      if (overlaps(cards[i], cards[j])) return [cards[i].uid, cards[j].uid];
    }
  }
  return null;
}
