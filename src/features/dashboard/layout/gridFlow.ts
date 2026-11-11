/**
 * [v2 网格 · 0.12.1末] 网格流式排布的**纯函数模拟**：给定卡表，算出每张卡
 * 在 `grid-auto-flow: dense` 下的落点（行 + 列），以及「把某卡拖到某格」后的
 * 新卡序与新 x。
 *
 * 为什么要有这层：CSS `dense` 的补位是浏览器算的，React 拿不到「哪张卡落在第几行」。
 * 拖拽排序要「其它卡让位」，必须**自己**能复现 dense 的落点算法，否则松手后的
 * 卡序和屏幕上看到的不一致（拖到一半松手，卡跳回原位 —— 安卓小组件桌面最忌讳）。
 *
 * 算法与 CSS 语义对齐：按卡序逐个放置，每张卡在「当前已占用的行」里从 x 起找
 * 第一个能横着放下 w 格的位置；放不下就落到下一行 x=0。这里**不存 y**，只负责
 * 在「给定卡序 + 各卡 x/w」下复现行占用，供拖拽层算目标落点。
 */
import { COLS, type LayoutCard } from "./contract";

export interface PlacedCard {
  id: LayoutCard["id"];
  /** 起始列（0..COLS-1） */
  x: number;
  /** 占宽（格） */
  w: number;
  /** 起始行（0-based，行高无关，只看占几行） */
  row: number;
  /** 占行数（h） */
  h: number;
}

/** 一行里 [colStart, colEnd) 的半开区间占用表。 */
type RowOccupy = Array<[number, number]>;

function canFit(row: RowOccupy, x: number, w: number): boolean {
  const end = x + w;
  if (end > COLS) return false;
  return row.every(([s, e]) => end <= s || x >= e);
}

/**
 * 复现 `grid-auto-flow: dense` 的落点：按卡序逐个放置，每张卡在「当前已占用的
 * 行」里从 x 起找第一个能横着放下 w 格、且连续 h 行都空的位置；放不下就落到
 * 更下一行。卡占 h 行时，把这 h 行都标记占用。
 */
export function placeCards(cards: LayoutCard[]): PlacedCard[] {
  const rows: RowOccupy[] = [];
  const out: PlacedCard[] = [];

  const fitsAt = (row: number, x: number, w: number, h: number): boolean => {
    for (let r = row; r < row + h; r += 1) {
      const occupy = rows[r] ?? (rows[r] = []);
      if (!canFit(occupy, x, w)) return false;
    }
    return true;
  };

  for (const card of cards) {
    let row = 0;
    while (!fitsAt(row, card.x, card.w, card.h)) {
      row += 1;
    }
    for (let r = row; r < row + card.h; r += 1) {
      (rows[r] ?? (rows[r] = [])).push([card.x, card.x + card.w]);
    }
    out.push({ id: card.id, x: card.x, w: card.w, h: card.h, row });
  }
  return out;
}

/**
 * 拖拽落点 → 新卡序 + 新 x。
 *
 * 给定当前卡表、被拖卡的 id、指针悬停的**目标格**（列 col、行 row），返回：
 *   · 新卡序：被拖卡插到「该格所在位置的卡」之前；
 *   · 新 x：吸附到目标列（夹到 [0, COLS - w]，让这张卡能横着放下）。
 *
 * 「让位」的语义：被拖卡从原位抽出后，其余卡按原序 dense 重排，再把它插到
 * 目标格对应的空隙前。这样松手后屏幕上的相对顺序就是落点看到的顺序。
 */
export function computeDrop(
  cards: LayoutCard[],
  draggedId: LayoutCard["id"],
  col: number,
  row: number,
): { cards: LayoutCard[]; x: number } {
  const dragged = cards.find((card) => card.id === draggedId);
  if (!dragged) return { cards, x: col };

  /* 抽出被拖卡，其余按原序排 */
  const rest = cards.filter((card) => card.id !== draggedId);
  const placed = placeCards(rest);

  /* 目标格对应的「前一张卡」：找 rest 里第一个「行 > row」或「行 == row 且列 >= col」的卡 */
  const insertBefore = placed.findIndex((p) => p.row > row || (p.row === row && p.x >= col));
  const index = insertBefore === -1 ? rest.length : insertBefore;

  const x = Math.min(col, COLS - dragged.w);
  const moved: LayoutCard = { ...dragged, x };
  const next = [...rest];
  next.splice(index, 0, moved);
  return { cards: next, x };
}
